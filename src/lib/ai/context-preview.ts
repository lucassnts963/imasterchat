import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { aiContextMessageLimit, buildSystemPrompt } from './defaults'
import { buildEnvironment } from './environment'
import { buildConversationContext } from './context'
import { loadGuardrails, describeGuardrails } from './guardrails'
import { loadVaultContext, describeVaultContext } from './vault/retrieve'
import { buildToolCatalog, resolveSchedulingContext } from './tools/registry'
import { describeWeeklyHours } from '@/lib/scheduling/settings'

// ============================================================
// O que o modelo sabe — o texto, não a estimativa.
//
// A `cost-projection` já montava este mesmo prompt para pesar cada
// pedaço. Ela responde "quanto custa"; esta responde "o que ele leu".
// São perguntas diferentes e a segunda é a que resolve chamado.
//
// O que motivou: o bot recusou um horário e o dono, olhando a agenda
// vazia, concluiu que estava quebrado. A resposta estava no contexto —
// a antecedência mínima de 2h — e não havia por onde ver o contexto.
// Cada rodada dessas terminava numa leitura de código.
//
// Por isso cada seção sai com ONDE se muda aquilo. Ver sem poder mexer
// é metade do problema.
//
// Construído com os mesmos construtores do caminho real, e não com uma
// cópia: uma cópia diverge, e uma tela de inspeção que mente é pior do
// que não ter tela.
// ============================================================

const CHARS_PER_TOKEN = 3.5

/** Onde a seção é editada. `null` = é o andaime, não se configura. */
export type ContextSource =
  | 'scaffold'
  | 'agent_settings'
  | 'scheduling_settings'
  | 'vault'
  | 'guardrails'
  | 'knowledge'
  | 'conversation'
  | 'tools'

export interface ContextSection {
  key: string
  /** O texto exato que vai ao modelo. */
  text: string
  tokens: number
  source: ContextSource
  /** Vazia porque não há o que dizer, ou porque não está configurado? */
  empty: boolean
}

export interface ContextPreview {
  sections: ContextSection[]
  totalTokens: number
  /** Presente quando o preview foi montado sobre uma conversa real. */
  conversationId: string | null
  timestampsEnabled: boolean
}

function estimate(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Monta o contexto como ele iria para o modelo agora.
 *
 * Com `conversationId`, usa a conversa de verdade — inclusive o
 * transcript e os fatos do contato. Sem ele, monta o genérico, que é o
 * que se quer ao conferir configuração.
 *
 * A base de conhecimento fica de fora de propósito: o que ela contribui
 * depende da pergunta do cliente, então mostrar "os 5 trechos" aqui
 * seria inventar uma pergunta que ninguém fez. A tela diz isso em vez
 * de fingir um número.
 */
export async function buildContextPreview(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null,
): Promise<ContextPreview | null> {
  const config = await loadAiConfig(db, accountId)
  if (!config) return null

  const scheduling = await resolveSchedulingContext(db, accountId)
  const timestamps = config.contextTimestamps !== false

  // Sem conversa, sem contato: o bloco de ambiente já sabe dizer isso
  // de si mesmo, e é o que o Playground vê.
  const contactId = conversationId
    ? await loadContactId(db, accountId, conversationId)
    : null

  const [environment, vault, guardrails, tools, transcript] = await Promise.all([
    buildEnvironment({
      db,
      accountId,
      contactId,
      timezone: scheduling?.settings.timezone,
      openingHours: scheduling ? describeWeeklyHours(scheduling.settings) : null,
      appointmentLabel: scheduling?.settings.appointmentLabel ?? null,
      transcriptStamps: timestamps,
    }),
    loadVaultContext(db, accountId, contactId),
    loadGuardrails(db, accountId),
    buildToolCatalog({ db, accountId, conversationId, scheduling }),
    conversationId
      ? buildConversationContext(db, conversationId, {
          limit: aiContextMessageLimit(config),
          timestamps,
          timezone: scheduling?.settings.timezone,
        })
      : Promise.resolve([]),
  ])

  // O andaime medido construindo o prompt vazio — assim o número é o
  // que o andaime É hoje, e não uma constante que alguém esqueceu.
  const scaffold = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })

  const sections: ContextSection[] = [
    mk('scaffold', scaffold, 'scaffold'),
    mk('environment', environment, 'scheduling_settings'),
    mk('vault', describeVaultContext(vault).join('\n\n'), 'vault'),
    mk('business_prompt', config.systemPrompt ?? '', 'agent_settings'),
    mk('guardrails', describeGuardrails(guardrails) ?? '', 'guardrails'),
    mk(
      'tools',
      tools
        .map((t) => `${t.name}: ${t.description}`)
        .join('\n'),
      'tools',
    ),
    mk(
      'transcript',
      transcript.map((m) => `${m.role}: ${m.content}`).join('\n'),
      'conversation',
    ),
  ]

  return {
    sections,
    totalTokens: sections.reduce((sum, s) => sum + s.tokens, 0),
    conversationId,
    timestampsEnabled: timestamps,
  }
}

function mk(key: string, text: string, source: ContextSource): ContextSection {
  const trimmed = text.trim()
  return {
    key,
    text: trimmed,
    tokens: estimate(trimmed),
    source,
    empty: trimmed.length === 0,
  }
}

async function loadContactId(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('contact_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle<{ contact_id: string | null }>()
  return data?.contact_id ?? null
}
