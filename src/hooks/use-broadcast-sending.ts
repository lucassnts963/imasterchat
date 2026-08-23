'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';
import {
  fetchCustomValueIndex,
  resolveVariables as resolveVars,
  type AudienceConfig,
  type VariableMapping,
} from '@/lib/broadcast/variables';

// Os tipos e a resolução de variáveis vivem em `@/lib/broadcast/variables`
// desde a onda 5.4: o envio saiu do navegador para o servidor, e uma
// segunda cópia da regra de `{{1}}` → "Ana" divergiria — aparecendo como
// mensagem enviada ao cliente com o nome errado.
export type {
  CustomFieldOperator,
  CustomFieldFilter,
  AudienceConfig,
  VariableMapping,
} from '@/lib/broadcast/variables';
import type { CustomFieldFilter } from '@/lib/broadcast/variables';
export { resolveVariables } from '@/lib/broadcast/variables';

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it. Passed through as `messageParams.headerMediaUrl`; the builder
   * falls back to the template's stored URL only when this is empty.
   */
  headerMediaUrl?: string;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

// O ritmo de ENVIO (lotes de 10 com 1s de pausa) e o resultado por
// destinatário mudaram de casa junto com o laço: agora vivem em
// `@/lib/broadcast/drain`, do lado do servidor. Deixá-los aqui seria
// deixar a receita de um bolo que esta cozinha não faz mais.
//
// A gravação dos destinatários continua aqui — é o que só o navegador
// pode fazer, porque é ele que resolveu o público.
const INSERT_BATCH_SIZE = 200;

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Uma linha de `broadcast_recipients` com o contato embutido, como a
 * consulta paginada do passo 4 a devolve. Só os campos que o laço de
 * envio realmente toca — o `*` traz mais, e tipar o resto seria
 * convidar a divergência com o schema.
 */
interface BroadcastRecipientRow {
  id: string;
  contact?: Contact | null;
}

/**
 * Lê uma tabela inteira em páginas.
 *
 * O PostgREST corta toda resposta em `PGRST_DB_MAX_ROWS` (1000 nesta
 * instalação) sem erro e sem aviso — quem não pagina simplesmente recebe
 * menos linhas do que existe e nunca fica sabendo.
 *
 * A página é menor que o teto de propósito, para o app não depender de
 * conhecer a configuração do servidor.
 */
async function fetchAllPaginated<T>(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<T[]> {
  const PAGE = 500;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      // Ordem estável entre páginas: sem ela o Postgres pode repetir ou
      // pular linhas, e repetir um contato aqui é mandar a mesma
      // mensagem duas vezes para a mesma pessoa.
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      // Paginado pelo mesmo motivo da leitura de destinatários: o teto
      // de linhas do PostgREST é silencioso, então "todos os contatos"
      // eram no máximo os 1000 primeiros — e o disparo saía parecendo
      // completo. Aqui o corte era ainda mais traiçoeiro, porque
      // acontecia ANTES de os destinatários serem gravados: nem a
      // contagem no banco denunciava.
      contacts = await fetchAllPaginated<Contact>(supabase, 'contacts');
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('id', uniqueContactIds);
        if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = data ?? [];
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Single round-trip lookup of existing contacts by phone.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .in('phone', phones);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byPhone = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // ── Step 4: entregar o envio ao SERVIDOR ──────────────────────
      //
      // O laço de envio vivia aqui, no navegador de quem clicou. Fechar
      // a aba interrompia o disparo pela metade — sem retomada, sem
      // aviso, e com os destinatários que faltavam simplesmente não
      // recebendo. A rede do atendente era variável do produto.
      //
      // Agora o navegador faz o que só ele pode fazer (resolver o
      // público e gravar as linhas) e marca `sending`. Quem envia é o
      // dreno do cron, a cada 5 minutos, em lotes — e retomar é de graça
      // porque o estado já está em `broadcast_recipients.status`: "o que
      // falta" é uma consulta, não um ponteiro que pode se perder.
      //
      // A barra de progresso não acompanha mais o envio em tempo real,
      // e isso é honesto: ela acompanhava um trabalho que agora não é
      // mais desta aba. Os contadores da tela de disparos continuam
      // certos — são mantidos pelo gatilho do banco a partir das linhas
      // de destinatário.
      setProgress(90);
      await supabase
        .from('broadcasts')
        .update({ status: 'sending' })
        .eq('id', broadcast.id);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
