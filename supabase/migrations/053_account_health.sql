-- ============================================================
-- 053 — Saúde por conta
--
-- A 052 registra falhas QUANDO ALGUÉM TENTA USAR. Isso deixa de fora
-- exatamente os dois casos mais caros: a chave da IA que vence de
-- madrugada e o Google revogado num domingo. Nos dois, a primeira
-- pessoa a descobrir é o cliente na segunda de manhã — e o intervalo
-- entre quebrar e alguém tentar usar é justamente o tempo em que dava
-- para ter consertado.
--
-- Esta tabela é o resultado de ir bater na porta de cada dependência
-- de hora em hora, sem esperar ninguém tentar.
--
-- UMA LINHA POR (CONTA, VERIFICAÇÃO), sobrescrita
--
-- Não é histórico — é estado atual. O histórico de quando quebrou já
-- está em `platform_events`, e duplicar aqui daria duas versões da
-- verdade que divergem. O que esta tabela responde é "como está agora",
-- que é a pergunta da tela.
--
-- `account_id` é nulável porque duas verificações não pertencem a
-- conta nenhuma: se as migrações do disco foram aplicadas, e se o cron
-- bateu ponto recentemente. São da plataforma inteira.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.health_status AS ENUM (
    'ok',
    'failing',
    -- Não dá para verificar, e isso NÃO é falha: a conta não conectou
    -- o Google, ou não configurou IA. Precisa ser distinto de 'ok'
    -- porque "não tem" e "tem e funciona" são coisas diferentes, e
    -- distinto de 'failing' porque não há nada para consertar.
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.account_health (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- 'ai_credentials' | 'whatsapp_token' | 'google_calendar'
  -- | 'migrations' | 'cron'
  -- Texto e não enum: acrescentar uma verificação não deve exigir
  -- migração.
  check_name  text NOT NULL,

  status      public.health_status NOT NULL,
  -- O código tipado da origem quando falhou: 'invalid_key',
  -- 'invalid_grant', 'rate_limited'. Mesmo vocabulário da 052 de
  -- propósito — é o que permite ligar a linha desta tabela ao evento
  -- que a produziu.
  code        text,
  detail      text,

  checked_at    timestamptz NOT NULL DEFAULT now(),
  -- Quando parou de funcionar. Preservado entre execuções enquanto
  -- continuar falhando, para a tela poder dizer "há 3 dias" em vez de
  -- "há 1 hora" toda hora.
  failing_since timestamptz,

  -- Quando saiu o último aviso POR ESTA VERIFICAÇÃO.
  --
  -- Sem isto, uma verificação de hora em hora sobre uma chave vencida
  -- vira 24 mensagens por dia sobre o mesmo problema já conhecido — e
  -- a janela de 15 minutos da 052 não segura, porque as execuções são
  -- de hora em hora. A política é: avisa na TRANSIÇÃO de ok para
  -- falhando, e só volta a avisar se ainda estiver quebrado 24h
  -- depois.
  last_alerted_at timestamptz,

  UNIQUE (account_id, check_name)
);

-- O UNIQUE acima não cobre as verificações de plataforma: em SQL,
-- NULL nunca é igual a NULL, então (NULL, 'migrations') poderia
-- duplicar indefinidamente a cada execução do cron. Este índice é o
-- que faz o upsert delas funcionar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_health_platform
  ON public.account_health (check_name)
  WHERE account_id IS NULL;

-- A tela: primeiro o que está quebrado.
CREATE INDEX IF NOT EXISTS idx_account_health_failing
  ON public.account_health (checked_at DESC)
  WHERE status = 'failing';

ALTER TABLE public.account_health ENABLE ROW LEVEL SECURITY;

-- Só o administrador da plataforma. Pelo mesmo motivo dos eventos de
-- erro da 052: isto é diagnóstico de infraestrutura, com nome de
-- código e chave rejeitada.
DROP POLICY IF EXISTS account_health_admin ON public.account_health;
CREATE POLICY account_health_admin ON public.account_health
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- O cron roda sob service role e passa por cima; esta política guarda
-- o dashboard.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_health TO authenticated;
