-- ============================================================
-- Os índices do caminho quente.
--
-- Levantados no estudo de carga (docs/carga-3000-mensagens.md): são as
-- quatro consultas que rodam a cada mensagem recebida ou a cada abertura
-- de conversa e que hoje varrem. Nenhuma dói com pouca linha — todas
-- dobram de custo junto com o histórico, que é o pior formato de
-- problema: parece rápido na demonstração e trava no cliente antigo.
--
-- `IF NOT EXISTS` em tudo: esta migração precisa poder rodar duas vezes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A leitura de uma conversa
--
-- O único índice em `messages` era `conversation_id` puro, e TODA
-- abertura de thread ordena por `created_at`. Sem a segunda coluna, o
-- Postgres busca as linhas da conversa e ORDENA na memória — com
-- `work_mem` em 4 MB, uma conversa longa derrama para disco.
--
-- Também é o índice que a API pública v1 precisa: ela pagina por keyset
-- corretamente e mesmo assim pagava a ordenação inteira para devolver
-- 50 linhas.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at);

-- ------------------------------------------------------------
-- 2. O webhook consultando disparos
--
-- `broadcast_recipients` é consultada por `contact_id` em TODA mensagem
-- recebida (para casar o status de entrega), e não tinha índice nessa
-- coluna. Ela cresce 3.000 linhas por disparo de 3.000 — ou seja, o
-- custo de RECEBER uma mensagem crescia com o número de disparos já
-- feitos. Dez disparos e são 30 mil linhas varridas por mensagem.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact
  ON public.broadcast_recipients (contact_id);

-- ------------------------------------------------------------
-- 3. A lista do inbox
--
-- Ordena por `last_message_at` dentro da conta, e existiam só índices
-- por `account_id`, `user_id` e `contact_id`.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message
  ON public.conversations (account_id, last_message_at DESC);

-- ------------------------------------------------------------
-- 4. "Minhas conversas"
--
-- Ainda não existe na tela (entra na onda 2), mas o índice entra agora
-- porque é a mesma migração e a mesma janela de manutenção. É também o
-- índice de que a distribuição por menos-ocupado vai precisar, se um dia
-- existir.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_assignee_status
  ON public.conversations (assigned_agent_id, status)
  WHERE assigned_agent_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. A busca de contato por telefone — a mais cara das cinco
--
-- Roda em TODA mensagem que chega. A consulta era
-- `LIKE '%<8 últimos dígitos>'` sobre a coluna `phone` crua: curinga à
-- ESQUERDA, que nenhum índice btree atende. O comentário no código dizia
-- que o pré-filtro evitava "puxar todo contato a cada mensagem" — ele
-- evitava o tráfego, não a varredura.
--
-- Já existia `phone_normalized` (gerada, só dígitos) com índice, e ela
-- não resolve este caso: casar sufixo continua sendo curinga à esquerda.
-- O que resolve é materializar o PRÓPRIO sufixo e comparar por
-- igualdade.
--
-- Oito dígitos porque é o que `phonesMatch` já usa para tolerar o zero
-- de tronco ("370063949836" e "37063949836" são o mesmo assinante).
-- Este índice é o pré-filtro; a checagem estrita continua em JS sobre o
-- punhado de candidatos.
--
-- A expressão repete o `regexp_replace` em vez de referenciar
-- `phone_normalized` porque o Postgres não deixa uma coluna gerada
-- depender de outra. É a mesma normalização do `normalizePhone` do TS
-- (`phone.replace(/\D/g, '')`) — se uma mudar, a outra precisa mudar
-- junto, ou a busca passa a não achar contato existente e o sistema
-- cria duplicata silenciosa.
-- ------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_suffix8 text
  GENERATED ALWAYS AS (right(regexp_replace(phone, '\D', '', 'g'), 8)) STORED;

CREATE INDEX IF NOT EXISTS idx_contacts_account_phone_suffix
  ON public.contacts (account_id, phone_suffix8);

COMMENT ON COLUMN public.contacts.phone_suffix8 IS
  'Últimos 8 dígitos do telefone, materializados para a busca do webhook. '
  'Espelha normalizePhone() de src/lib/whatsapp/phone-utils.ts — mudar um '
  'lado sem o outro faz o sistema deixar de reconhecer contatos existentes.';
