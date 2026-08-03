-- ============================================================
-- Como ESTE negócio chama um agendamento
--
-- O produto nasceu numa ótica, e o vocabulário foi junto: "consulta"
-- em toda a tela de agendamento. Para uma loja de bicicletas elétricas
-- o cliente pede uma DEMONSTRAÇÃO, e para uma empresa de projetos
-- fotovoltaicos é uma VISITA TÉCNICA. Chamar as três de "consulta" faz
-- o produto parecer de outro ramo — e, pior, faz o bot devolver ao
-- cliente uma palavra que ele não usou.
--
-- Uma coluna e não uma tabela de segmentos: o que muda entre um ramo e
-- outro é uma palavra, e uma lista fechada de ramos erra no primeiro
-- cliente que não se encaixa nela.
--
-- NULO ou vazio é o caso normal, não um defeito: significa "use o termo
-- genérico". Toda conta existente continua exatamente como estava.
--
-- O texto é curto de propósito. Ele entra no contexto do agente, e um
-- campo livre longo aqui seria uma porta lateral para instruções — o
-- limite mantém isto um substantivo, não um parágrafo.
-- ============================================================

ALTER TABLE public.ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS appointment_label text;

ALTER TABLE public.ai_scheduling_settings
  DROP CONSTRAINT IF EXISTS ai_scheduling_settings_appointment_label_check;

ALTER TABLE public.ai_scheduling_settings
  ADD CONSTRAINT ai_scheduling_settings_appointment_label_check
  CHECK (
    appointment_label IS NULL
    OR char_length(btrim(appointment_label)) BETWEEN 1 AND 40
  );

COMMENT ON COLUMN public.ai_scheduling_settings.appointment_label IS
  'Como a conta chama um agendamento: "consulta", "demonstração", '
  '"visita técnica". Aparece na interface e é o termo que o agente usa '
  'com o cliente. NULO = termo genérico.';
