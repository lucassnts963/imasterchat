-- ============================================================
-- 081 — módulo de cobrança (fase 4) e integrações (fase 5)
--
-- Uma régua de cobrança NÃO é uma automação com esperas. Ela é dirigida
-- por uma data de vencimento que existe fora do CRM e por um estado que
-- muda sozinho — o associado pagou ontem, e o disparo de D+3 não pode
-- sair. O motor de automações é reativo a evento de CONVERSA; não existe
-- gatilho de estado de uma cobrança, e modelar isso como "automação com
-- waits" produz o defeito clássico: o `wait` não observa nada enquanto
-- espera, e o D+5 sai para quem já quitou.
--
-- O que este arquivo cria:
--
--   integrations       de onde vêm os dados, com credencial cifrada
--   cobrancas          o espelho local do que está em aberto
--   reguas             os degraus, por conta
--   regua_degraus      offset em dias, template, hora, ligado/desligado
--   regua_disparos     um por (cobrança, degrau), ÚNICO — a idempotência
--   cobranca_promessas "pago sexta", que reagenda em vez de repetir
--
-- Três decisões que valem antes de ler o schema:
--
--   1. `cobrancas.origem` NÃO tem CHECK. Fonte nova não pode virar erro
--      de constraint — mesma razão de `whatsapp_message_costs` não
--      restringir as categorias da Meta.
--   2. `cobrancas.status` TEM CHECK: é vocabulário nosso, não de
--      terceiro.
--   3. `regua_disparos` guarda os disparos SUPRIMIDOS junto com os
--      enviados, e o motivo. Supressão silenciosa é indepurável, e a
--      pergunta "por que fulano não recebeu?" é a primeira que o cliente
--      faz.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Integrações — de onde vêm os dados
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Id do catálogo (`src/lib/integrations/catalog.ts`). Sem CHECK: um
  -- adaptador novo é um deploy, não uma migração.
  provider      text NOT NULL,
  label         text,
  -- Credenciais cifradas com o MESMO AES-256-GCM da chave de IA e do
  -- token da Meta. Nenhum mecanismo novo.
  credentials   text,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integrations_account_provider_idx
  ON integrations (account_id, provider);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integrations_rw ON integrations;
CREATE POLICY integrations_rw ON integrations FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 2. Cobranças — o espelho local
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobrancas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Quem recebe. Nulo enquanto não casar com um contato: cobrança órfã é
  -- VISÍVEL numa fila própria, não descartada.
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Quem DEVE, que pode não ser quem recebe. É a chave do agrupamento:
  -- quem tem três títulos vencidos recebe UMA mensagem, não três.
  titular_ref   text,
  -- Telefone cru, quando não deu para casar com contato. É o que o
  -- operador usa para resolver a órfã.
  telefone_bruto text,
  origem        text NOT NULL,
  id_externo    text NOT NULL,
  descricao     text,
  valor         numeric(14, 2) NOT NULL,
  vencimento    date NOT NULL,
  status        text NOT NULL DEFAULT 'aberta'
                CHECK (status IN ('aberta', 'paga', 'cancelada', 'negociando')),
  pago_em       date,
  valor_pago    numeric(14, 2),
  link_pagamento text,
  codigo_pix    text,
  linha_digitavel text,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Reentrega do fornecedor, ou reimportação da mesma planilha, não pode
-- duplicar a carteira.
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_externo_idx
  ON cobrancas (account_id, origem, id_externo);

-- O padrão de leitura do worker: as abertas desta conta, por vencimento.
CREATE INDEX IF NOT EXISTS cobrancas_abertas_idx
  ON cobrancas (account_id, vencimento)
  WHERE status = 'aberta';

CREATE INDEX IF NOT EXISTS cobrancas_titular_idx
  ON cobrancas (account_id, titular_ref)
  WHERE status = 'aberta';

ALTER TABLE cobrancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobrancas_rw ON cobrancas;
CREATE POLICY cobrancas_rw ON cobrancas FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 3. A régua
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reguas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  -- Janela legal de contato (CDC art. 42 + SARB 27/2023), em JSON:
  --   { "seg_sex": ["08:00","20:00"], "sab": ["08:00","14:00"],
  --     "dom": null, "feriados": false }
  -- Imposta pelo WORKER, não sugerida na tela: um degrau que dispara
  -- domingo às 22h não é bug de UX, é exposição jurídica do cliente.
  janela      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Teto anti-assédio: quantos contatos por título num período, e o
  -- intervalo mínimo entre degraus.
  max_contatos_periodo int NOT NULL DEFAULT 4,
  periodo_dias         int NOT NULL DEFAULT 30,
  intervalo_minimo_dias int NOT NULL DEFAULT 2,
  -- Quantos dias uma resposta do titular pausa a régua dele.
  pausa_apos_resposta_dias int NOT NULL DEFAULT 3,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reguas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reguas_rw ON reguas;
CREATE POLICY reguas_rw ON reguas FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS regua_degraus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regua_id      uuid NOT NULL REFERENCES reguas(id) ON DELETE CASCADE,
  -- Negativo é o aviso de "vence em N dias", que costuma ser o que mais
  -- reduz inadimplência. Zero é o vencimento.
  offset_dias   int NOT NULL,
  template_name text NOT NULL,
  template_language text,
  -- Variáveis posicionais do template, com `{{cobranca.*}}` disponível.
  template_vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  hora_do_dia   time NOT NULL DEFAULT '09:00',
  -- Fluxo que assume se o cliente responder. Opcional: sem ele o degrau
  -- é só o template.
  flow_id       uuid REFERENCES flows(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS regua_degraus_offset_idx
  ON regua_degraus (regua_id, offset_dias);

ALTER TABLE regua_degraus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regua_degraus_rw ON regua_degraus;
CREATE POLICY regua_degraus_rw ON regua_degraus FOR ALL
  USING (EXISTS (
    SELECT 1 FROM reguas r
     WHERE r.id = regua_degraus.regua_id
       AND is_account_member(r.account_id, 'agent')))
  WITH CHECK (EXISTS (
    SELECT 1 FROM reguas r
     WHERE r.id = regua_degraus.regua_id
       AND is_account_member(r.account_id, 'admin')));

-- ------------------------------------------------------------
-- 4. Disparos — a idempotência e a auditoria
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regua_disparos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cobranca_id   uuid NOT NULL REFERENCES cobrancas(id) ON DELETE CASCADE,
  degrau_id     uuid NOT NULL REFERENCES regua_degraus(id) ON DELETE CASCADE,
  -- enviado | suprimido
  resultado     text NOT NULL CHECK (resultado IN ('enviado', 'suprimido')),
  -- Só em `suprimido`: fora_da_janela | teto_atingido | ja_paga |
  -- agrupado | sem_contato | promessa | pausada | erro
  motivo        text,
  -- O texto COMO FOI ENVIADO, não o template. O template muda; o que a
  -- pessoa recebeu, não. É a defesa se o cliente for questionado.
  texto_enviado text,
  -- Liga ao custo da mensagem (migração 075), para responder "quanto
  -- custou recuperar este título".
  message_id    text,
  -- Quando um disparo cobriu vários títulos do mesmo titular, os outros
  -- apontam para ele.
  agrupado_em   uuid REFERENCES regua_disparos(id) ON DELETE SET NULL,
  disparado_em  timestamptz NOT NULL DEFAULT now()
);

-- A TRAVA. Um ENVIO por (cobrança, degrau): rodar o worker duas vezes no
-- mesmo dia não manda a mesma cobrança duas vezes. A unicidade é do
-- banco, não do código.
--
-- Parcial de propósito. Se ela cobrisse as supressões também, um degrau
-- suprimido às 3h por estar fora da janela legal não poderia mais ser
-- enviado às 9h do MESMO dia — e a proteção legal viraria uma cobrança
-- perdida. Supressão é linha de auditoria e pode repetir; envio, não.
CREATE UNIQUE INDEX IF NOT EXISTS regua_disparos_envio_unico_idx
  ON regua_disparos (cobranca_id, degrau_id)
  WHERE resultado = 'enviado';

-- Leitura do worker: o que já aconteceu com esta cobrança.
CREATE INDEX IF NOT EXISTS regua_disparos_cobranca_idx
  ON regua_disparos (cobranca_id, disparado_em DESC);

CREATE INDEX IF NOT EXISTS regua_disparos_conta_idx
  ON regua_disparos (account_id, disparado_em DESC);

ALTER TABLE regua_disparos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regua_disparos_select ON regua_disparos;
CREATE POLICY regua_disparos_select ON regua_disparos FOR SELECT
  USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 5. Promessa de pagamento
-- ------------------------------------------------------------
--
-- "Pago sexta" precisa REAGENDAR o próximo degrau, não repetir a mesma
-- cobrança na quinta.
CREATE TABLE IF NOT EXISTS cobranca_promessas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cobranca_id  uuid NOT NULL REFERENCES cobrancas(id) ON DELETE CASCADE,
  promessa_para date NOT NULL,
  registrada_por uuid,
  origem       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobranca_promessas_cobranca_idx
  ON cobranca_promessas (cobranca_id, promessa_para DESC);

ALTER TABLE cobranca_promessas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobranca_promessas_rw ON cobranca_promessas;
CREATE POLICY cobranca_promessas_rw ON cobranca_promessas FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 6. Feriados
-- ------------------------------------------------------------
--
-- Nacional por padrão, com acréscimo por conta: feriado municipal é o
-- caso comum e ninguém fora do cliente sabe quais são.
CREATE TABLE IF NOT EXISTS feriados (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = feriado nacional, vale para todas as contas.
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  data        date NOT NULL,
  nome        text
);

CREATE UNIQUE INDEX IF NOT EXISTS feriados_unico_idx
  ON feriados (COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), data);

ALTER TABLE feriados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feriados_select ON feriados;
CREATE POLICY feriados_select ON feriados FOR SELECT
  TO authenticated
  USING (account_id IS NULL OR is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS feriados_write ON feriados;
CREATE POLICY feriados_write ON feriados FOR ALL
  USING (account_id IS NOT NULL AND is_account_member(account_id, 'admin'))
  WITH CHECK (account_id IS NOT NULL AND is_account_member(account_id, 'admin'));
