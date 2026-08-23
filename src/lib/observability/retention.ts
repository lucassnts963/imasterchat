import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Retenção: a única tabela de log que hoje sabe se apagar.
//
// Nenhuma tabela de log tinha política de retenção — nem `pg_cron`, nem
// job de purga, nem `DELETE` agendado em lugar nenhum do repositório.
// Todas crescem para sempre.
//
// `platform_events` é a primeira porque é a pior, e por um motivo que
// não é tamanho: ela guarda `screenshot`, um data URL de print de tela
// INTEIRO dentro da linha. Um print de caixa de entrada carrega a
// conversa de um cliente da ótica — dado de terceiro, guardado por
// tempo indeterminado, dentro de uma tabela que só o admin da
// plataforma lê. Guardar isso para sempre é um risco que não paga
// nenhum benefício.
//
// Por isso a política é em DOIS TEMPOS, e não uma só:
//
//   7 dias   o print é apagado, o evento fica
//   90 dias  o evento inteiro sai
//
// O print serve para diagnosticar um problema desta semana. Depois
// disso, o que resta de útil é "aconteceu isto, nesta conta, neste
// dia" — que é pequeno, não é dado de terceiro, e é o que faz o
// histórico valer alguma coisa.
// ============================================================

/** Depois disto, o print vai embora e o evento fica. */
const SCREENSHOT_TTL_DAYS = 7

/** Depois disto, o evento inteiro sai. */
const EVENT_TTL_DAYS = 90

/**
 * Teto por execução.
 *
 * A ronda roda de hora em hora; 5.000 por vez drenam qualquer acúmulo
 * realista em poucas horas sem que uma execução segure a tabela num
 * `DELETE` longo. Uma purga que trava a escrita de eventos é pior que a
 * tabela grande que ela veio resolver.
 */
const MAX_ROWS_PER_RUN = 5_000

export interface RetentionResult {
  screenshotsCleared: number
  eventsDeleted: number
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/**
 * Aplica a retenção. Best-effort de ponta a ponta.
 *
 * Chamada pela ronda de saúde, que já roda de hora em hora com o mesmo
 * segredo — em vez de um agendador novo, que seria mais uma coisa para
 * alguém esquecer de configurar num deploy novo.
 *
 * Nunca lança: a ronda existe para DETECTAR problema, e derrubá-la por
 * causa da faxina inverteria o propósito dela.
 */
export async function purgeExpiredLogs(
  db: SupabaseClient,
): Promise<RetentionResult> {
  const result: RetentionResult = { screenshotsCleared: 0, eventsDeleted: 0 }

  try {
    // 1. O print sai primeiro, e sozinho: é o que pesa e o que é dado
    //    de terceiro. `select('id')` para saber quantas linhas mudaram
    //    — o PostgREST não devolve contagem num update sem isso.
    const { data: cleared, error: clearErr } = await db
      .from('platform_events')
      .update({ screenshot: null })
      .lt('created_at', daysAgo(SCREENSHOT_TTL_DAYS))
      .not('screenshot', 'is', null)
      .select('id')
      .limit(MAX_ROWS_PER_RUN)

    if (clearErr) throw clearErr
    result.screenshotsCleared = cleared?.length ?? 0
  } catch (err) {
    console.error('[retention] falha ao limpar screenshots:', err)
  }

  try {
    const { data: deleted, error: delErr } = await db
      .from('platform_events')
      .delete()
      .lt('created_at', daysAgo(EVENT_TTL_DAYS))
      .select('id')
      .limit(MAX_ROWS_PER_RUN)

    if (delErr) throw delErr
    result.eventsDeleted = deleted?.length ?? 0
  } catch (err) {
    console.error('[retention] falha ao apagar eventos:', err)
  }

  if (result.screenshotsCleared || result.eventsDeleted) {
    console.log(
      `[retention] platform_events: ${result.screenshotsCleared} prints limpos, ${result.eventsDeleted} eventos apagados`,
    )
  }

  return result
}
