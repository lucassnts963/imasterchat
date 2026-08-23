-- ============================================================
-- 052 — Platform events: falhas e relatos, na mesma tabela
--
-- Hoje o caminho do bot tem dezesseis saídas distintas para "parou de
-- responder um cliente" e apenas quatro deixam rastro — e são
-- justamente as benignas (humano assumiu, guardrail funcionou, o bot
-- pediu ajuda). As patológicas — chave vencida, token do Meta
-- expirado, migração faltando, rate limit — não deixam nada além de
-- uma linha no stdout do container. O operador descobre quando o
-- cliente liga.
--
-- Isto é o `flow_run_events` / `automation_logs` que a IA nunca teve,
-- e o padrão é copiado de propósito: já é maduro no repo e já tem tela
-- para servir de referência.
--
-- POR QUE FALHA E RELATO NA MESMA TABELA
--
-- Porque a pergunta que importa cruza os dois. Quando a cliente
-- escreve "o bot parou", o valor não está no texto dela — está em ver,
-- na mesma lista e na mesma linha do tempo, que a conta dela acumulou
-- catorze `invalid_key` desde as 6h. Duas tabelas obrigariam a fazer
-- esse join na cabeça, toda vez. `kind` separa os dois mundos onde
-- eles precisam ser separados, e só ali.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.platform_event_kind AS ENUM (
    -- Algo quebrou, e quem percebeu foi o código.
    'error',
    -- Alguém digitou. Vem do widget de feedback dentro do app.
    'report'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.platform_event_severity AS ENUM (
    -- Nada quebrou; é contexto que explica um silêncio. O caso que
    -- motivou existir: a conta tem uma automação de mensagem ativa e
    -- por isso o agente de IA se cala inteiro. Não é bug, mas é a
    -- primeira coisa que alguém precisa saber ao investigar.
    'info',
    -- Degradou. O bot respondeu, mas pior — sem o vault, sem a base de
    -- conhecimento, sem as ferramentas de agendamento no catálogo.
    'warning',
    -- Um cliente ficou sem resposta.
    'error',
    -- A conta inteira está fora do ar, ou o bot falou do que era
    -- proibido falar.
    'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.platform_event_status AS ENUM (
    'open',
    -- Visto, e alguém está com ele.
    'ack',
    'resolved'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.platform_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nulo quando o evento não pertence a ninguém: um webhook que chegou
  -- com um phone_number_id desconhecido é exatamente esse caso, e é
  -- justamente o que ninguém consegue diagnosticar hoje.
  account_id  uuid REFERENCES public.accounts(id) ON DELETE CASCADE,

  kind        public.platform_event_kind NOT NULL,
  severity    public.platform_event_severity NOT NULL DEFAULT 'error',
  status      public.platform_event_status NOT NULL DEFAULT 'open',

  -- Que subsistema falou: 'ai', 'whatsapp', 'google', 'cron',
  -- 'billing', 'scheduling', 'app'. Texto livre e não enum de
  -- propósito: um subsistema novo não deve exigir migração para
  -- conseguir gritar.
  source      text NOT NULL,

  -- O slug que agrupa. Vem TIPADO da origem — `AiError.code` já
  -- distingue `invalid_key`, `rate_limited`, `timeout`,
  -- `network_error`, `provider_error`, e `GoogleError.code` já
  -- distingue `invalid_grant`. Hoje essa informação existe e é jogada
  -- fora dentro de um console.error. É por `code` que o alerta
  -- deduplica, e é por `code` que se conta "quantas contas com o mesmo
  -- problema".
  code        text NOT NULL,

  message     text NOT NULL,
  -- Tudo que ajuda a reproduzir e nada que identifique o cliente final
  -- da ótica: tela, build, user agent, id da conversa, argumentos da
  -- ferramenta que falhou.
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,

  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  -- Quem reportou (kind='report'), ou nulo quando foi o código.
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Data URL do print, opcional e desligado por padrão no widget.
  -- Fica em coluna própria e não no `context` porque é grande e porque
  -- nenhuma listagem deve arrastá-lo junto — as telas selecionam
  -- colunas explicitamente e esta fica de fora até alguém abrir o
  -- evento.
  --
  -- Um print da caixa de entrada carrega a conversa de um cliente da
  -- ótica: dado de terceiro. Por isso é escolha explícita de quem
  -- reporta, com aviso na tela, e não algo capturado por padrão.
  screenshot  text,

  -- Quando o alerta saiu (Telegram). Nulo = nunca alertado, e é o que
  -- faz a deduplicação funcionar sem tabela auxiliar: "já avisei sobre
  -- este `code` nesta conta nos últimos quinze minutos?" é uma query
  -- nesta coluna. Sem isso, um provedor fora do ar vira duzentas
  -- mensagens no celular.
  alerted_at  timestamptz,

  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A tela: o que aconteceu, mais recente primeiro.
CREATE INDEX IF NOT EXISTS idx_platform_events_created
  ON public.platform_events (created_at DESC);

-- "Esta conta está bem?" — a pergunta que se faz com o cliente na
-- linha.
CREATE INDEX IF NOT EXISTS idx_platform_events_account
  ON public.platform_events (account_id, created_at DESC);

-- A janela de deduplicação do alerta, no caminho quente de toda falha.
CREATE INDEX IF NOT EXISTS idx_platform_events_dedupe
  ON public.platform_events (code, created_at DESC)
  WHERE alerted_at IS NOT NULL;

-- A fila de trabalho. Parcial porque o que está resolvido não é fila.
CREATE INDEX IF NOT EXISTS idx_platform_events_open
  ON public.platform_events (created_at DESC)
  WHERE status <> 'resolved';

ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;

-- O administrador da plataforma vê e faz tudo. É o único que vê os
-- eventos de erro: eles carregam nome de código, chave rejeitada e
-- migração faltando — diagnóstico de infraestrutura, não informação
-- que o dono de uma ótica precise ou queira ver.
DROP POLICY IF EXISTS platform_events_admin ON public.platform_events;
CREATE POLICY platform_events_admin ON public.platform_events
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Quem reporta enxerga o próprio relato — e só o relato. É o que
-- fecha o ciclo: o cliente abre o widget, vê que o que ele mandou
-- ontem está como resolvido, e lê a nota. Sem isso o widget é uma
-- caixa onde se joga texto.
DROP POLICY IF EXISTS platform_events_report_select ON public.platform_events;
CREATE POLICY platform_events_report_select ON public.platform_events
  FOR SELECT USING (
    kind = 'report'
    AND user_id = auth.uid()
    AND public.is_account_member(account_id)
  );

-- Qualquer membro reporta. Deliberadamente não é decisão de admin:
-- quem topa no problema é a atendente, e exigir que ela peça à dona da
-- ótica para reportar é garantir que nada seja reportado.
--
-- O WITH CHECK trava o que o cliente pode alegar ser: relato, na conta
-- dele, em nome dele. Um membro não consegue forjar um evento de erro
-- nem plantar um relato na conta de outro.
DROP POLICY IF EXISTS platform_events_report_insert ON public.platform_events;
CREATE POLICY platform_events_report_insert ON public.platform_events
  FOR INSERT WITH CHECK (
    kind = 'report'
    AND user_id = auth.uid()
    AND public.is_account_member(account_id)
    AND status = 'open'
    AND alerted_at IS NULL
    AND resolved_at IS NULL
  );

-- O gravador de erros roda sob service role (o webhook não tem
-- auth.uid()) e passa por cima de tudo acima; estas políticas guardam
-- o dashboard.

GRANT SELECT, INSERT ON public.platform_events TO authenticated;
GRANT UPDATE, DELETE ON public.platform_events TO authenticated;
