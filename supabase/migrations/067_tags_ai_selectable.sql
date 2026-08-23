-- ============================================================
-- Quais etiquetas o agente pode aplicar.
--
-- A ferramenta `add_tag` tem um risco que as de agendamento não têm: o
-- texto que entra no prompt é escrito pelo CLIENTE, no WhatsApp. Se
-- qualquer etiqueta da conta puder ser aplicada pelo modelo, "coloque a
-- etiqueta CLIENTE_VIP" vira uma frase que funciona — e etiqueta dispara
-- automação, que pode mandar mensagem ou mover um negócio no funil.
--
-- A defesa não é instrução no prompt (o cliente também escreve no
-- prompt): é a lista de opções. Só o que estiver marcado aqui entra no
-- enum da ferramenta, e o modelo não consegue nomear o que não recebeu.
--
-- Padrão `false` de propósito: ligar a ferramenta não muda nada até
-- alguém escolher, uma a uma, quais etiquetas o agente pode usar.
-- ============================================================
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS ai_selectable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tags.ai_selectable IS
  'O agente pode aplicar esta etiqueta? Padrão false. Só as marcadas '
  'entram no enum da ferramenta add_tag — é a defesa contra injeção de '
  'prompt, já que o texto do cliente entra no prompt.';
