import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { runAgent } from './agent'
import { buildEnvironment } from './environment'
import {
  describeGuardrails,
  guardrailHandoffSummary,
  loadGuardrails,
  matchKeywordGuardrail,
} from './guardrails'
import { describeVaultContext, loadVaultContext } from './vault/retrieve'
import { buildToolCatalog, resolveSchedulingContext } from './tools/registry'
import { describeWeeklyHours } from '@/lib/scheduling/settings'
import { recordAgentSteps } from './steps'
import { aiContextMessageLimit, buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { AiError } from './types'
import { handOffConversation, DEFAULT_HANDOFF_NOTICE } from '@/lib/conversations/handoff'
import {
  clearPending,
  markPending,
  monthSpendUsd,
  passAiGate,
  releaseAiSlot,
} from './queue-gate'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { recordEvent } from '@/lib/observability/events'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) {
      // Não é falha, é a causa nº 1 de chamado: o cliente cria uma
      // automação de boas-vindas por palavra-chave e o agente de IA
      // para de responder no dia seguinte, sem nada em tela dizendo
      // isso — e ele reporta como bug nosso.
      await recordEvent({
        accountId,
        conversationId,
        source: 'ai',
        code: 'standing_down_for_automation',
        severity: 'info',
        message:
          'A conta tem automação de mensagem ativa, então o agente de IA não respondeu (para não duplicar a resposta ao cliente).',
        context: { automationId: autoResponders[0].id },
      })
      return
    }

    // The customer just spoke, so the reply budget starts over (045).
    // It bounds a bot talking when nobody is talking to it — not a long
    // back-and-forth the customer is driving. Done before the read below
    // so the cap check sees the reset value, and filtered on `gt` so a
    // conversation already at zero costs no write.
    //
    // This also un-sticks a thread that hit the cap once and went mute:
    // the next message from that customer wakes the bot up again.
    await db
      .from('conversations')
      .update({ ai_reply_count: 0 })
      .eq('id', conversationId)
      .gt('ai_reply_count', 0)

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_reply_total, ai_pending_since',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    // ---------------------------------------------------------------
    // O portão: cabe agora, espera, ou vira gente?
    //
    // Regra de produto: "melhor uma mensagem que demorou a ser
    // respondida do que alguém que ficou sem resposta". Nenhum caminho
    // daqui sai em silêncio.
    // ---------------------------------------------------------------
    const budgetUsd = config.monthlyBudgetUsd ?? null
    let budgetExceeded = false
    if (budgetUsd && budgetUsd > 0) {
      try {
        budgetExceeded = (await monthSpendUsd(db, accountId)) >= budgetUsd
      } catch (err) {
        // Não sabemos o gasto: seguir é a escolha menos ruim. Barrar por
        // uma consulta que falhou deixaria o cliente sem resposta por um
        // problema nosso.
        console.error('[auto-reply] leitura do gasto do mês falhou:', err)
      }
    }

    const pendingSince =
      (conv as { ai_pending_since?: string | null }).ai_pending_since ?? null

    const gate = await passAiGate({
      db,
      accountId,
      conversationId,
      concurrencyLimit: config.aiConcurrencyLimit ?? 5,
      maxWaitSeconds: config.aiMaxWaitSeconds ?? 300,
      budgetExceeded,
      budgetAction: config.budgetExceededAction ?? 'block_and_handoff',
      pendingSince,
    })

    if (gate.kind === 'wait') {
      // Entra na fila e sai. O cron tenta de novo; o relógio da espera
      // já está correndo, e é ele que garante que isto termina.
      await markPending(db, conversationId)
      return
    }

    if (gate.kind === 'handoff') {
      if (pendingSince) await clearPending(db, conversationId)
      const why =
        gate.reason === 'budget'
          ? 'Orçamento mensal de IA esgotado.'
          : `Sem vaga para responder em ${Math.round(gate.waitedSeconds / 60)} min.`
      await handOffConversation({
        db,
        accountId,
        conversationId,
        summary: `🤖 ${why} Precisa de atendimento humano.`,
        assignTo: config.handoffAgentId,
      })
      void recordEvent({
        accountId,
        source: 'ai',
        code: gate.reason === 'budget' ? 'budget_exceeded' : 'ai_queue_timeout',
        severity: 'warning',
        message:
          gate.reason === 'budget'
            ? `Orçamento mensal esgotado — a conversa foi transferida para uma pessoa.`
            : `Conversa esperou ${gate.waitedSeconds}s por uma vaga da IA e foi transferida.`,
        context: { conversationId },
      })
      return
    }

    // A partir daqui a vaga está reservada e PRECISA ser devolvida.
    //
    // A limpeza da marcação só acontece para quem ESTAVA na fila. No
    // caminho feliz — a esmagadora maioria — não havia marcação, e uma
    // escrita a mais por mensagem numa rota que já faz de 16 a 35
    // consultas não é detalhe.
    if (pendingSince) await clearPending(db, conversationId)

    // Resolvido AQUI e não mais abaixo: o catálogo de ferramentas e o
    // bloco de ambiente sempre precisaram dele, e agora a marcação do
    // transcript também — as marcas saem no relógio do negócio, e um
    // fuso errado num transcript com datas é pior do que transcript sem
    // data nenhuma.
    const scheduling = await resolveSchedulingContext(db, accountId)

    const messages = await buildConversationContext(db, conversationId, {
      limit: aiContextMessageLimit(config),
      timestamps: config.contextTimestamps !== false,
      timezone: scheduling?.settings.timezone,
    })
    if (messages.length === 0) return

    // The shop's own list of what the bot must not touch. Loaded before
    // anything is spent, because half of it is enforced right here.
    const guardrails = await loadGuardrails(db, accountId)

    // Keyword guardrails run BEFORE the model — no provider call, no
    // chance of the model being argued out of it. A customer who says
    // "advogado" gets a person, and gets one whether or not the LLM
    // would have agreed that this counts.
    const tripped = matchKeywordGuardrail(
      latestUserMessage(messages),
      guardrails.keywords,
    )
    if (tripped) {
      await handOffConversation({
        db,
        accountId,
        conversationId,
        summary: guardrailHandoffSummary(tripped),
        assignTo: config.handoffAgentId,
      })
      return
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      // ESPERA, em vez de ficar sem resposta.
      //
      // Antes este ramo devolvia e pronto: a mensagem ficava na caixa
      // para um humano ver — o que na prática é ninguém, porque nada
      // avisava. Agora entra na mesma fila do teto de concorrência, e o
      // relógio de 5 minutos garante que termina em resposta ou em
      // transferência.
      await markPending(db, conversationId)
      await recordEvent({
        accountId,
        conversationId,
        source: 'ai',
        code: 'account_rate_limited',
        severity: 'warning',
        message:
          'Limite de respostas por minuto da conta atingido — a conversa entrou na fila.',
        context: { limit: RATE_LIMITS.aiAutoReplyAccount.limit },
      })
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Who we're talking to and what day it is. Cheap, and it removes a
    // whole class of confidently-wrong answers about dates.
    const environment = await buildEnvironment({
      db,
      accountId,
      contactId,
      timezone: scheduling?.settings.timezone,
      openingHours: scheduling ? describeWeeklyHours(scheduling.settings) : null,
      appointmentLabel: scheduling?.settings.appointmentLabel ?? null,
      // Sem esta nota o modelo imita o formato que acabou de ver e o
      // cliente recebe "[2026-08-03 08:12] Claro, posso ajudar".
      transcriptStamps: config.contextTimestamps !== false,
      conversationId,
      newSessionHours: config.newSessionHours,
      audioTranscripts: config.audioPolicy === 'transcribe',
    })

    // The wiki the account maintains: approved rules, what is true
    // right now, and this customer's own page. Only approved pages —
    // a draft is a proposal, not something to answer a customer with.
    const vault = await loadVaultContext(db, accountId, contactId)

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      environment,
      vault: describeVaultContext(vault),
      guardrails: describeGuardrails(guardrails),
    })

    // The tools this account actually has. `request_human` is always
    // there; scheduling appears only when it is switched on.
    const tools = await buildToolCatalog({
      db,
      accountId,
      conversationId,
      scheduling,
    })

    const { text, handoff, handoffSource, usage, steps } = await runAgent({
      config,
      systemPrompt,
      messages,
      tools,
      ctx: { db, accountId, conversationId, contactId, config },
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way. A run that used tools is logged as 'agent' so the cost of the
    // loop is separable from a plain reply.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: steps.length > 0 ? 'agent' : 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Same treatment for the audit trail — never on the critical path.
    if (steps.length > 0) {
      void recordAgentSteps(db, { accountId, conversationId, steps })
    }

    if (handoff || !text) {
      // The model can't (or shouldn't) answer. `request_human` already
      // wrote the handoff, with a reason better than anything we could
      // reconstruct here — don't overwrite it. Otherwise record it now:
      // pause the bot on this thread (sticky until re-enabled), route to
      // the configured agent (null leaves it in the shared queue), and
      // leave a note for whoever picks it up. Assigning fires the
      // `on_conversation_assigned` trigger, which notifies the agent.
      if (handoffSource !== 'tool') {
        await handOffConversation({
          db,
          accountId,
          conversationId,
          summary: buildHandoffSummary({
            messages,
            // The lifetime tally, not the per-turn budget: "handed off
            // after 6 replies" tells the attendant how long the bot had
            // been at this, which the reset counter no longer can.
            replyCount: conv.ai_reply_total ?? 0,
          }),
          assignTo: config.handoffAgentId,
        })
      }

      // O aviso vai DEPOIS de a transferência estar gravada. Se a ordem
      // fosse a inversa e o handoff falhasse, o cliente teria ouvido
      // "alguém vai te procurar" sobre uma fila em que ele não entrou —
      // a única forma de errar aqui que é pior do que o silêncio de
      // antes.
      //
      // Não fala em "humano" nem em "robô": o cliente não precisa saber
      // com quem estava falando, precisa saber que o assunto foi
      // encaminhado e que vão retornar.
      if (config.handoffNoticeEnabled) {
        const notice = (config.handoffNoticeText ?? '').trim() || DEFAULT_HANDOFF_NOTICE
        try {
          await engineSendText({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: notice,
            aiGenerated: true,
          })
        } catch (noticeErr) {
          // Falhar aqui não desfaz a transferência, que é o que
          // importa: a conversa já está na fila e alguém vai atender.
          console.error('[ai auto-reply] handoff notice failed:', noticeErr)
        }
      }
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      await recordEvent({
        accountId,
        conversationId,
        source: 'ai',
        code: 'claim_slot_failed',
        severity: 'critical',
        message: `claim_ai_reply_slot falhou: ${claimErr.message}`,
        context: { hint: 'migração 029 aplicada? GRANT EXECUTE no service role?' },
      })
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    // Este catch existe para o webhook nunca cair por causa da IA, e
    // isso continua certo. O que estava errado era ele ser o fim da
    // linha: chave revogada, sem crédito, timeout do provedor,
    // ENCRYPTION_KEY rotacionada e token do Meta vencido chegavam
    // todos aqui e viravam a mesma linha de stdout — indistinguíveis
    // de "ninguém mandou mensagem hoje".
    //
    // O `code` já vem tipado de `providerHttpError`. Só precisava ser
    // gravado em vez de descartado.
    const code =
      err instanceof AiError
        ? err.code
        : err instanceof Error && err.name === 'GoogleError'
          ? 'google_error'
          : 'dispatch_failed'

    // 429 do provedor não é fim de linha: é "tente daqui a pouco".
    //
    // Tanto a OpenAI quanto a Anthropic mandam `Retry-After`, e a
    // Anthropic avisa que um pico dispara 429 mesmo abaixo do teto do
    // plano — ou seja, acontece justamente quando ninguém pode ficar sem
    // resposta. Entrar na fila é o que transforma isso em atraso em vez
    // de perda; o relógio de 5 minutos fecha o resto.
    if (code === 'rate_limited') {
      await markPending(supabaseAdmin(), conversationId)
    }

    await recordEvent({
      accountId,
      conversationId,
      source: 'ai',
      code,
      // Chave inválida ou sem crédito é a conta inteira muda, não uma
      // conversa. É o modo de falha mais caro do produto.
      severity:
        code === 'invalid_key' || code === 'quota_exceeded'
          ? 'critical'
          : 'error',
      message: err instanceof Error ? err.message : String(err),
      context: { stage: 'dispatch' },
    })
  } finally {
    // A vaga volta SEMPRE — sucesso, erro, ou saída antecipada.
    //
    // `finally` e não no fim do try: um erro no meio da resposta
    // deixaria a vaga presa, e o teto da conta encolheria a cada falha
    // até o bot parar de responder. Uma conta que emudece porque falhou
    // cinco vezes semana passada é o tipo de defeito que ninguém liga à
    // causa.
    //
    // Soltar uma vaga que nunca foi reivindicada é um DELETE que não
    // acha nada — barato e inofensivo.
    await releaseAiSlot(supabaseAdmin(), conversationId)
  }
}
