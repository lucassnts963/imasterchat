-- ============================================================
-- O vocabulário que o transcritor deve esperar
--
-- O `initial_prompt` do faster-whisper inclina a decodificação para um
-- campo semântico. Medido com áudio real de cliente, mesmo modelo e
-- mesma máquina:
--
--   sem viés   "Você consegue reagir a andar para mim na quarta-feira?"
--   com viés   "Você consegue reagendar para mim na quarta-feira?"
--
-- A base — verbos de agendamento, dias da semana — serve a todo mundo e
-- fica no código. O que NÃO serve a todo mundo é o vocabulário do ramo:
-- uma ótica fala de armação, lente antirreflexo e grau; uma loja de
-- bicicletas elétricas fala de autonomia, pedal assistido e bateria de
-- lítio. Nenhum dos dois adivinha o do outro, e errar essas palavras é
-- errar justamente o assunto da conversa.
--
-- Nulo é o caso normal: fica só a base. Quem tiver jargão que o Whisper
-- erra escreve aqui, e a correção não passa por deploy.
--
-- Só o provedor LOCAL usa. A ElevenLabs não expõe equivalente — o campo
-- fica visível apenas quando a conta escolheu o local, para não
-- prometer efeito que não vai acontecer.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS transcription_vocabulary text;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_transcription_vocabulary_check;

-- Teto de 500. O `initial_prompt` do Whisper compete por espaço com o
-- próprio áudio na janela do modelo: um texto longo demais empurra o
-- começo da fala para fora e piora justamente o que veio corrigir.
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_transcription_vocabulary_check
  CHECK (
    transcription_vocabulary IS NULL
    OR char_length(btrim(transcription_vocabulary)) BETWEEN 1 AND 500
  );

COMMENT ON COLUMN public.ai_configs.transcription_vocabulary IS
  'Palavras do ramo que o transcritor local deve esperar — nomes de '
  'produto, jargão, marcas. Somadas à base de agendamento que vive no '
  'código. Nulo usa só a base.';
