-- ============================================================
-- Notificação deixa de nascer em inglês
--
-- A 027 monta a frase dentro do gatilho:
--
--     'New conversation assigned'
--     COALESCE(v_actor_name,'Someone') || ' assigned you a conversation with ' || …
--
-- O app é pt-BR. Nenhuma tradução no front alcançava esse texto, porque
-- ele não passa pelo front: chega pronto do Postgres, em inglês, e a
-- tela só imprime. É por isso que o aviso do celular sai certo (aquele
-- é montado no app) e o de dentro do app não.
--
-- A correção separa DADO de FRASE. O gatilho passa a gravar só os
-- nomes, que é o que ele realmente sabe; quem monta a frase é a tela,
-- que é quem sabe a língua de quem está lendo.
--
-- Os nomes ficam gravados na linha em vez de virem por join, e isso é
-- de propósito: notificação é registro do que aconteceu. Se a atendente
-- trocar de nome depois, o aviso de ontem deve continuar dizendo o nome
-- de ontem — e ainda funciona se o perfil for apagado.
--
-- `title` e `body` viram anuláveis e param de ser preenchidos. As
-- linhas antigas continuam com o texto em inglês e a tela ainda as
-- imprime: reescrever histórico seria inventar tradução para o que já
-- foi lido.
-- ============================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE public.notifications ALTER COLUMN title DROP NOT NULL;

COMMENT ON COLUMN public.notifications.title IS
  'LEGADO. Frase pronta, em inglês, escrita pelo gatilho até a 055. '
  'Linhas novas nascem NULAS — a tela monta o texto a partir de `type`, '
  '`actor_name` e `contact_name`.';

CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name text;
  v_actor_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  -- Sem `title`/`body`: só os fatos. A frase é montada na tela, na
  -- língua de quem lê. NULO em `actor_name` significa "não foi uma
  -- pessoa" (automação, regra), e a tela tem texto próprio para isso —
  -- diferente de um 'Someone' que fingia ser gente.
  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, actor_name, contact_name
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    NULLIF(v_actor_name, ''),
    NULLIF(v_contact_name, '')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;
