import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Escrever no CRM, sem motor por perto — fase 1, R-6.
//
// Atualizar um campo, criar um negócio, atribuir ou fechar uma conversa
// eram cinco blocos dentro do motor de automações. Nada neles é de
// automação: são regras do CRM, e o fluxo precisa das mesmas.
//
// Cada função devolve `{ ok, message }` em vez de lançar. Quem chama são
// motores que continuam depois deste passo: numa automação, lançar
// mataria todos os passos seguintes; num fluxo, deixaria o cliente
// falando sozinho. Uma escrita que não deu é um fato a registrar, não um
// incidente.
//
// Tenancy é conferida aqui, em toda função. Os motores rodam com o
// cliente de service-role, que passa por cima do RLS — então ou a
// checagem está neste arquivo, ou não está em lugar nenhum.
// ============================================================

export interface CrmWriteResult {
  ok: boolean
  /** Uma frase sobre o que aconteceu, para o log do passo ou do run. */
  message: string
}

const WRITABLE_CONTACT_COLUMNS = new Set(['name', 'email', 'company'])

/**
 * Escreve num campo do contato — coluna nativa ou campo personalizado.
 *
 * Campos personalizados chegam como `custom:<id>`; qualquer outra coisa
 * é coluna nativa, e só as três da lista branca. A lista existe porque
 * `field` vem de configuração que um operador escreve, e sem ela um
 * `phone` ou um `account_id` seriam graváveis daqui.
 */
export async function updateContactField(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  field: string
  /** Já interpolado por quem chamou — este módulo não conhece as
   *  variáveis de nenhum motor. */
  value: string
}): Promise<CrmWriteResult> {
  const { db, accountId, contactId, field, value } = args

  if (field.startsWith('custom:')) {
    const customFieldId = field.slice('custom:'.length)
    if (!customFieldId) {
      return { ok: false, message: `field ${field} not writable` }
    }
    // Defesa em profundidade: confirmar que a definição do campo é desta
    // conta antes de escrever.
    const { data: definition } = await db
      .from('custom_fields')
      .select('id')
      .eq('id', customFieldId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!definition) {
      return { ok: false, message: `field ${field} not writable` }
    }
    // Upsert sobre o UNIQUE(contact_id, custom_field_id), para execuções
    // repetidas sobrescreverem em vez de duplicar.
    const { error } = await db
      .from('contact_custom_values')
      .upsert(
        { contact_id: contactId, custom_field_id: customFieldId, value },
        { onConflict: 'contact_id,custom_field_id' },
      )
    if (error) return { ok: false, message: `custom field write failed: ${error.message}` }
    return { ok: true, message: 'custom field updated' }
  }

  if (!WRITABLE_CONTACT_COLUMNS.has(field)) {
    return { ok: false, message: `field ${field} not writable` }
  }
  const { error } = await db
    .from('contacts')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('account_id', accountId)
  if (error) return { ok: false, message: `${field} write failed: ${error.message}` }
  return { ok: true, message: `${field} updated` }
}

/**
 * Cria um negócio no funil.
 *
 * A moeda vem da conta, e não do `DEFAULT` da coluna: a regra do produto
 * é uma moeda por conta, e um negócio criado por robô em dólar dentro de
 * um funil em real é a espécie de inconsistência que ninguém percebe até
 * somar o pipeline.
 */
export async function createDeal(args: {
  db: SupabaseClient
  accountId: string
  /** Autor de registro — o dono da automação ou do fluxo. */
  userId: string
  pipelineId: string
  stageId: string
  contactId: string | null
  title: string
  value?: number | null
}): Promise<CrmWriteResult> {
  const { db, accountId } = args
  if (!args.pipelineId || !args.stageId) {
    return { ok: false, message: 'deal needs a pipeline and a stage' }
  }

  const { data: account } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle()

  const { error } = await db.from('deals').insert({
    account_id: accountId,
    user_id: args.userId,
    pipeline_id: args.pipelineId,
    stage_id: args.stageId,
    contact_id: args.contactId,
    title: args.title,
    value: args.value ?? 0,
    currency: (account as { default_currency?: string } | null)?.default_currency ?? 'USD',
    status: 'open',
  })
  if (error) return { ok: false, message: `deal not created: ${error.message}` }
  return { ok: true, message: 'deal created' }
}

/**
 * Põe a conversa do contato na mão de alguém.
 *
 * `any_member` NÃO é rodízio, e o rótulo na tela deixou de prometer que
 * fosse: sem ORDER BY e sem estado do último escolhido, o Postgres
 * devolve a linha que quiser — na prática quase sempre a mesma pessoa.
 * A chave continua `round_robin` para não quebrar as automações já
 * salvas; rodízio de verdade é por FILA, com cursor travado na linha, e
 * entra como um modo novo quando existir.
 */
export async function assignConversation(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  mode: 'specific' | 'round_robin' | string
  agentId?: string | null
}): Promise<CrmWriteResult> {
  const { db, accountId, contactId } = args
  let agentId = args.agentId ?? null

  if (args.mode === 'round_robin') {
    const { data: profiles } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .limit(1)
    agentId = (profiles?.[0] as { user_id?: string } | undefined)?.user_id ?? null
  }
  if (!agentId) return { ok: false, message: 'no agent resolved' }

  const { error } = await db
    .from('conversations')
    .update({ assigned_agent_id: agentId })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  if (error) return { ok: false, message: `assign failed: ${error.message}` }
  return { ok: true, message: `assigned to ${agentId}` }
}

export async function closeConversation(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
}): Promise<CrmWriteResult> {
  const { error } = await args.db
    .from('conversations')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
  if (error) return { ok: false, message: `close failed: ${error.message}` }
  return { ok: true, message: 'conversation closed' }
}
