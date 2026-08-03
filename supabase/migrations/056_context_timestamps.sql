-- ============================================================
-- O transcript ganha datas
--
-- O contexto do agente era `sender_type` + `content_text`, e mais nada.
-- Um transcript sem datas é um transcript sem ontem: para o modelo,
-- tudo aconteceu agora.
--
-- O caso que motivou isto, com os passos gravados em `ai_agent_steps`:
--
--   02/08 23:51  cliente: "Amanhã as 11"
--                bot agenda 03/08 11:00
--                bot: "agendada para amanhã às 11:00"
--   03/08 07:51  cliente: "Consegue reagendar para as 14hrs?"
--                bot chama check_availability(04/08 → 04/08)
--
-- Ele nem olhou o dia de hoje. E o raciocínio está certo, dado o que
-- ele viu: a última frase do transcript dizia "agendada para amanhã às
-- 11:00", sem nenhuma marca de quando foi dita. Não havia como saber
-- que aquilo era de ontem — então "amanhã" continuava sendo amanhã, e
-- "as 14hrs" virou amanhã às 14h. O cliente foi movido de dia e
-- avisado como se fosse o combinado.
--
-- O bloco de ambiente já mandava a data de hoje. Não bastava: saber que
-- hoje é 03/08 não diz quando cada frase da conversa foi dita.
--
-- ------------------------------------------------------------
-- POR QUE É UMA CHAVE, E NÃO O PADRÃO PARA TODOS
--
-- Marcar 20 mensagens custa algo em torno de 100–160 tokens por
-- resposta, na chave do próprio cliente. Para quem usa agendamento é
-- barato pelo que resolve. Para uma conta que só responde dúvida de
-- produto, é custo puro em toda resposta, todo dia.
--
-- LIGADO por padrão, ao contrário do que a economia sugeriria: quem
-- tem agendamento é quem mais sofre com a falha, e a falha é silenciosa
-- — ninguém liga uma chave para um bug que não sabe que tem. Quem não
-- precisa desliga uma vez e nunca mais pensa nisso; quem precisa seria
-- mordido antes de descobrir que existia chave.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS context_timestamps boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ai_configs.context_timestamps IS
  'Marca cada mensagem do transcript com data e hora no fuso do '
  'negócio. Necessário para o agente distinguir "ontem" de "hoje" — '
  'sem isso ele lê um "amanhã" dito ontem como ainda sendo amanhã. '
  'Custa ~100-160 tokens por resposta; desligue em contas que não '
  'usam agendamento.';
