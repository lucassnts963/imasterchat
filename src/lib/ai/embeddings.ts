import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Embeddings (OpenAI-compatible wire format).
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval.
//
// Deliberately independent of the chat provider. Anthropic has never had
// an embeddings endpoint and DeepSeek closed the request as not-planned,
// so an account can perfectly well run chat on one host and embeddings
// on another — `resolveEmbeddingsTarget` in providers/catalog.ts is what
// decides where this goes.
// ============================================================

/**
 * The dimension the knowledge base is built for. Matches the
 * `vector(1024)` column and the casts inside
 * `match_ai_knowledge_semantic` (migration 074) — changing it here
 * without changing those is a runtime failure, so they move together.
 *
 * 1024 because that is where the good open multilingual models sit
 * natively (`baai/bge-m3`, `intfloat/multilingual-e5-large`), and this
 * CRM's knowledge bases are mostly not in English. pgvector's HNSW index
 * also caps at 2000 dimensions, which rules out the 3072-dim tier
 * regardless.
 */
export const EMBEDDING_DIMENSIONS = 1024

/** Where and what to embed with. Built by `resolveEmbeddingsTarget`. */
export interface EmbeddingsTarget {
  apiKey: string
  /** Origin, no trailing slash. `/embeddings` is appended. */
  baseUrl: string
  model: string
}

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[]
}

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Embed a list of strings, preserving input order. Batched; throws
 * `AiError` on provider/network failure so callers can decide whether
 * to degrade (retrieval) or surface (ingest).
 */
export async function embedTexts(
  target: EmbeddingsTarget,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []
  const timeoutMs = aiRequestTimeoutMs()
  const out: number[][] = []

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)

    let res: Response
    try {
      res = await fetch(`${target.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: target.model,
          input: batch,
          // Sent unconditionally. Models with Matryoshka support (the
          // `text-embedding-3-*` family among them) need it to come back
          // at our column width, and hosts serving a natively 1024-dim
          // model either honour it or ignore it as an unknown field.
          // A host that rejects it outright surfaces at configuration
          // time — the save-time probe in /api/ai/config runs this exact
          // path — rather than midway through a reindex.
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('Embeddings', res)
    }

    const data = (await res.json().catch(() => null)) as EmbeddingResponse | null
    const rows = data?.data
    if (!rows || rows.length !== batch.length) {
      throw new AiError('Embeddings response was malformed.', {
        code: 'embeddings_malformed',
      })
    }

    // Sort by index so order matches the input batch regardless of how
    // the provider returns them. Require a real numeric index — defaulting
    // a missing one to 0 would silently misalign chunks with their
    // vectors (chunk N gets chunk M's embedding), so fail loud instead.
    if (rows.some((r) => typeof r.index !== 'number')) {
      throw new AiError('Embeddings response was missing result indices.', {
        code: 'embeddings_malformed',
      })
    }
    const ordered = [...rows].sort((a, b) => a.index! - b.index!)
    for (const r of ordered) {
      if (!Array.isArray(r.embedding)) {
        throw new AiError('Embeddings response missing a vector.', {
          code: 'embeddings_malformed',
        })
      }
      out.push(r.embedding)
    }
  }

  return out
}

/**
 * Embed one probe string and confirm the model returns vectors of the
 * width the knowledge base is built for.
 *
 * Without this, a model of the wrong dimension is accepted at save time
 * and fails much later, inside a reindex, as a Postgres type error on an
 * insert — which tells the operator nothing about which setting is
 * wrong. Here it fails on the save that caused it, naming both numbers.
 *
 * Throws `AiError`; resolves on success.
 */
export async function validateEmbeddingsTarget(
  target: EmbeddingsTarget,
): Promise<void> {
  const [probe] = await embedTexts(target, ['ping'])
  if (!probe) {
    throw new AiError('The embeddings endpoint returned no vector.', {
      code: 'embeddings_malformed',
    })
  }
  if (probe.length !== EMBEDDING_DIMENSIONS) {
    throw new AiError(
      `"${target.model}" returns ${probe.length}-dimensional vectors, but the knowledge base stores ${EMBEDDING_DIMENSIONS}. Choose a model of ${EMBEDDING_DIMENSIONS} dimensions — baai/bge-m3 is one.`,
      { code: 'embeddings_dimension_mismatch', status: 400 },
    )
  }
}
