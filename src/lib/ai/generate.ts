import type { AiConfig, AiUsage, ChatMessage, GenerateResult } from './types'
import { HANDOFF_SENTINEL } from './defaults'
import { runAgent } from './agent'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 *
 * This is `runAgent` with no tools: one provider call, handoff sentinel
 * parsed out, text returned. It stays as its own function because two
 * surfaces genuinely want single-shot behaviour — the inbox draft
 * button (a human is about to edit the text; a bot booking an
 * appointment behind their back would be a surprise) and the "test key"
 * check in settings.
 *
 * Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { text, handoff, usage } = await runAgent(args)
  return { text, handoff, usage }
}

/**
 * Split raw model output into `{ text, handoff, usage }`. The sentinel
 * can appear alone or trailing a partial reply; either way we treat the
 * turn as a handoff and strip the marker from any remaining text.
 * `usage` is passed straight through (null when the provider didn't
 * report it).
 *
 * Still exported because the sentinel protocol outlives tool calling:
 * accounts with no tools configured — and the draft path, which never
 * gets tools — depend on it.
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
