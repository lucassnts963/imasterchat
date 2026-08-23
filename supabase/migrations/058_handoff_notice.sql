-- ============================================================
-- Avisar o cliente antes de passar para uma pessoa
--
-- Hoje o handoff é mudo do lado de quem espera. O bot para de
-- responder, a conversa entra na fila, e o cliente fica olhando para
-- uma tela que não diz nada. Do ponto de vista dele, o atendimento
-- travou.
--
-- O `lib/conversations/handoff.ts` diz, no cabeçalho, que NÃO manda
-- mensagem de propósito: "Telling them 'let me get someone' is the
-- caller's decision — the auto-reply path stays silent, while a bot
-- that already promised a human should not send it twice." A regra está
-- certa e continua valendo; o que faltava era o caminho automático ter
-- como tomar essa decisão em vez de só não tomá-la.
--
-- Configurável e DESLIGADO por padrão, ao contrário das outras chaves
-- que introduzimos. O motivo é assimétrico: ligar acrescenta uma
-- mensagem que o cliente recebe, e mensagem enviada não volta atrás.
-- Uma conta que não pediu isso não pode começar a falar sozinha depois
-- de um deploy.
--
-- O texto é da conta, não nosso. "Vou transferir para o setor
-- responsável" cabe numa consultoria e soa estranho numa ótica de
-- bairro; quem sabe qual é o tom é quem atende. Vazio com a chave
-- ligada usa um padrão neutro.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS handoff_notice_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS handoff_notice_text text;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_handoff_notice_text_check;

ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_handoff_notice_text_check
  CHECK (
    handoff_notice_text IS NULL
    OR char_length(btrim(handoff_notice_text)) BETWEEN 1 AND 300
  );

COMMENT ON COLUMN public.ai_configs.handoff_notice_enabled IS
  'Avisar o cliente quando a conversa for passada para uma pessoa. '
  'Desligado por padrão: ligar faz o bot enviar uma mensagem a mais, e '
  'mensagem enviada não volta atrás.';

COMMENT ON COLUMN public.ai_configs.handoff_notice_text IS
  'O texto do aviso, nas palavras da conta. Nulo usa um padrão neutro. '
  'Teto de 300 para caber numa mensagem de WhatsApp sem virar parágrafo.';
