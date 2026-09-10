-- ============================================================
-- 079 — prazo por nó e pausa no handoff (fase 2, R-10 e R-12)
--
-- A migração 078 deu ao fluxo um relógio: `resume_at` diz quando o cron
-- deve voltar para buscar um run. Duas coisas novas usam o MESMO
-- relógio, e é por isso que `resume_kind` precisa existir.
--
-- Os três motivos de um run ter hora marcada, e por que a varredura de
-- abandono trata cada um de um jeito:
--
--   wait           o fluxo decidiu dormir. A varredura NÃO pode matá-lo:
--                  um degrau de "espera 3 dias" seria varrido em 24h
--   node_timeout   o CLIENTE está calado num menu. É exatamente o que a
--                  política de abandono do fluxo mede, então aqui o
--                  menor dos dois prazos vence
--   handoff_pause  uma pessoa assumiu a conversa. Volta quando ela
--                  devolver, ou morre no prazo, para não segurar o
--                  índice de um run ativo por contato para sempre
--
-- Sem esta coluna as três seriam indistinguíveis, e a varredura teria de
-- escolher entre matar quem dorme ou nunca cobrar quem se calou.
-- ============================================================

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS resume_kind TEXT;

ALTER TABLE flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_resume_kind_check;

ALTER TABLE flow_runs
  ADD CONSTRAINT flow_runs_resume_kind_check
  CHECK (
    resume_kind IS NULL
    OR resume_kind IN ('wait', 'node_timeout', 'handoff_pause')
  );

COMMENT ON COLUMN flow_runs.resume_kind IS
  'Por que este run tem hora marcada. NULL quando não tem. Ver migração 079: a varredura de abandono trata cada motivo de um jeito.';

-- Runs existentes que já dormem vieram todos de um nó `wait` — a 078 não
-- tinha outro jeito de gravar `resume_at`.
UPDATE flow_runs
   SET resume_kind = 'wait'
 WHERE resume_at IS NOT NULL
   AND resume_kind IS NULL;
