-- ============================================================
-- O que fazer quando chega um áudio
--
-- Hoje: nada. O webhook guarda o áudio, a caixa de entrada mostra, e o
-- agente NUNCA é chamado — a porta é `inboundText.trim()`, e para áudio
-- essa string é vazia. O cliente manda um áudio e o bot fica calado.
-- Sem resposta, sem transferência, sem erro.
--
-- Pior: o contexto filtra `content_type = 'text'`, então se o cliente
-- mandar um áudio e depois escrever, o bot responde ao texto como se o
-- áudio não existisse — e pode contradizer o que foi dito ali.
--
-- E há uma assimetria dentro do próprio produto: automações com
-- `new_message_received` DISPARAM para áudio, porque esse gatilho não é
-- filtrado por texto. Uma conta com automação responde; a mesma conta
-- só com IA fica muda.
--
-- Quatro políticas, porque o certo depende do negócio e do bolso:
--
--   ignore      o de hoje. Guarda e não faz nada
--   notice      responde pedindo por escrito. Barato, acaba com o silêncio
--   transcribe  transcreve e trata como texto dali em diante
--   handoff     manda para uma pessoa
--
-- `ignore` é o padrão, e é o comportamento atual — pela mesma razão do
-- aviso de transferência: `notice` e `handoff` fazem o bot FALAR com o
-- cliente, e nenhuma conta pode começar a falar sozinha depois de um
-- deploy.
--
-- ------------------------------------------------------------
-- POR QUE A TRANSCRIÇÃO É A OPÇÃO ELEGANTE
--
-- Ela grava o texto em `content_text` da própria mensagem. Dali para
-- frente TUDO já funciona sem alteração: o contexto passa a incluir,
-- `keyword_match` passa a casar, os guardrails passam a valer, o
-- agendamento passa a entender. Não é um caminho paralelo — é fazer o
-- áudio entrar pelo caminho que já existe.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS audio_policy text NOT NULL DEFAULT 'ignore',
  ADD COLUMN IF NOT EXISTS audio_notice_text text,
  ADD COLUMN IF NOT EXISTS audio_transcription_provider text NOT NULL DEFAULT 'local',
  -- Cifrada com o ENCRYPTION_KEY, como as outras chaves de provedor.
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key text;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_audio_policy_check,
  DROP CONSTRAINT IF EXISTS ai_configs_audio_provider_check,
  DROP CONSTRAINT IF EXISTS ai_configs_audio_notice_text_check;

ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_audio_policy_check
    CHECK (audio_policy IN ('ignore', 'notice', 'transcribe', 'handoff')),
  ADD CONSTRAINT ai_configs_audio_provider_check
    CHECK (audio_transcription_provider IN ('elevenlabs', 'local')),
  ADD CONSTRAINT ai_configs_audio_notice_text_check
    CHECK (
      audio_notice_text IS NULL
      OR char_length(btrim(audio_notice_text)) BETWEEN 1 AND 300
    );

COMMENT ON COLUMN public.ai_configs.audio_policy IS
  'O que fazer com áudio recebido: ignore (padrão, o comportamento '
  'anterior), notice (pedir por escrito), transcribe (transcrever e '
  'seguir como texto), handoff (passar para uma pessoa).';

COMMENT ON COLUMN public.ai_configs.audio_transcription_provider IS
  'local usa o serviço Whisper da própria VPS — sem custo por minuto e '
  'sem o áudio do cliente sair daqui. elevenlabs usa a API deles, que é '
  'mais rápida e mais precisa, e cobra por minuto.';
