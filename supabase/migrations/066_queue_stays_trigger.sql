-- ============================================================
-- O histórico de fila é mantido pelo BANCO, não pela aplicação.
--
-- Por quê: `conversations` é escrita de muitos lugares, e um deles é o
-- NAVEGADOR — o dropdown de atribuição e o seletor de status do inbox
-- fazem UPDATE direto na tabela, autorizados só pela RLS
-- (`components/inbox/message-thread.tsx`). Automações, fluxos, o
-- webhook e a API pública escrevem por caminhos próprios.
--
-- Manter as estadas em TypeScript exigiria lembrar de chamar o mesmo
-- helper em todos esses lugares, para sempre, inclusive nos que ainda
-- não existem. O primeiro esquecido produz um buraco permanente no
-- relatório — e um buraco que só aparece meses depois, quando alguém
-- pergunta quanto tempo o Financeiro levou em julho.
--
-- Um gatilho não tem como ser esquecido.
--
-- O preço é que o MOTIVO da saída passa a ser derivado da transição, e
-- não informado por quem move. Vale a troca: um motivo aproximado com
-- histórico completo é muito melhor que um motivo preciso com falhas.
-- ============================================================

-- ------------------------------------------------------------
-- Conversa nova, em DOIS tempos — e é o banco que obriga a isso.
--
-- A fila só pode ser escrita ANTES de a linha existir (`NEW.queue_id`
-- num BEFORE), e a estada só pode ser criada DEPOIS, porque ela tem
-- chave estrangeira para `conversations`. Tentar as duas coisas num
-- BEFORE INSERT falha com violação de FK — o teste pegou exatamente
-- isso antes de a migração ser aplicada.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_conversation_default_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- O webhook cria a conversa sem fila. Em vez de mudar o webhook (e os
  -- outros criadores, e os futuros), a fila padrão é atribuída aqui —
  -- é o que torna verdadeira a regra "toda conversa está sempre em
  -- exatamente uma fila".
  IF NEW.queue_id IS NULL THEN
    SELECT id INTO NEW.queue_id
      FROM public.queues
     WHERE account_id = NEW.account_id AND is_default
     LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.open_conversation_queue_stay()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.queue_id IS NOT NULL AND NEW.status <> 'closed' THEN
    INSERT INTO public.conversation_queue_stays
      (account_id, conversation_id, queue_id, assigned_user_id)
    VALUES (NEW.account_id, NEW.id, NEW.queue_id, NEW.assigned_agent_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;  -- AFTER trigger: o retorno é ignorado.
END $$;

CREATE OR REPLACE FUNCTION public.sync_conversation_queue_stay()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue   uuid;
  v_reason  text;
BEGIN
  -- ---------- encerrada ----------
  -- Deixa de esperar alguém, e não passa a esperar em outro lugar.
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    UPDATE public.conversation_queue_stays
       SET left_at = now(), exit_reason = 'closed'
     WHERE conversation_id = NEW.id AND left_at IS NULL;
    RETURN NEW;
  END IF;

  -- ---------- reaberta ----------
  -- Volta para a fila em que está (que a reabertura já pode ter mudado).
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    SELECT COALESCE(
             NEW.queue_id,
             (SELECT id FROM public.queues
               WHERE account_id = NEW.account_id AND is_default LIMIT 1)
           ) INTO v_queue;
    IF v_queue IS NOT NULL THEN
      NEW.queue_id := v_queue;
      INSERT INTO public.conversation_queue_stays
        (account_id, conversation_id, queue_id, assigned_user_id)
      VALUES (NEW.account_id, NEW.id, v_queue, NEW.assigned_agent_id)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- ---------- mudou de fila ----------
  IF NEW.queue_id IS DISTINCT FROM OLD.queue_id AND NEW.queue_id IS NOT NULL THEN
    -- O motivo é derivado: se a IA acabou de ser desligada nesta mesma
    -- escrita, foi transferência para gente; senão, alguém moveu à mão.
    v_reason := CASE
      WHEN NEW.ai_autoreply_disabled AND NOT COALESCE(OLD.ai_autoreply_disabled, false)
        THEN 'handoff'
      ELSE 'manual'
    END;

    UPDATE public.conversation_queue_stays
       SET left_at = now(), exit_reason = v_reason
     WHERE conversation_id = NEW.id AND left_at IS NULL;

    INSERT INTO public.conversation_queue_stays
      (account_id, conversation_id, queue_id, assigned_user_id)
    VALUES (NEW.account_id, NEW.id, NEW.queue_id, NEW.assigned_agent_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- ---------- só mudou de dono ----------
  -- A estada aberta acompanha, para o histórico dizer quem estava com a
  -- conversa naquela passagem — e não só em qual fila ela estava.
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    UPDATE public.conversation_queue_stays
       SET assigned_user_id = NEW.assigned_agent_id
     WHERE conversation_id = NEW.id AND left_at IS NULL;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.sync_conversation_queue_stay()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_conversation_default_queue()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.open_conversation_queue_stay()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_conversation_queue_stay ON public.conversations;
DROP TRIGGER IF EXISTS trg_set_conversation_default_queue ON public.conversations;
DROP TRIGGER IF EXISTS trg_open_conversation_queue_stay ON public.conversations;

-- 1. Antes de gravar: define a fila.
CREATE TRIGGER trg_set_conversation_default_queue
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_conversation_default_queue();

-- 2. Depois de gravar: abre a estada (a FK exige a linha já existindo).
CREATE TRIGGER trg_open_conversation_queue_stay
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.open_conversation_queue_stay();

-- 3. Nas mudanças: BEFORE, porque o ramo de reabertura escreve em
--    `NEW.queue_id`, e isso só tem efeito antes da gravação.
CREATE TRIGGER trg_sync_conversation_queue_stay
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_queue_stay();

COMMENT ON FUNCTION public.sync_conversation_queue_stay() IS
  'Mantém conversation_queue_stays em dia a partir de conversations. Vive '
  'no banco porque o navegador escreve direto na tabela — um helper de '
  'aplicação dependeria de todo caminho lembrar de chamá-lo.';
