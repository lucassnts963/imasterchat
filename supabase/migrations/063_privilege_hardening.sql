-- ============================================================
-- Três buracos de privilégio, todos confirmados em produção.
--
-- Achados por uma auditoria de cinco lentes independentes (11-12/08/2026)
-- e reconfirmados um a um contra o banco desta VPS antes desta migração
-- ser escrita. Nenhum deles é teórico:
--
--   1. Qualquer usuário logado virava admin DA PLATAFORMA com um PATCH.
--   2. Qualquer visitante SEM LOGIN podia chamar RPCs destrutivas que
--      rodam como postgres sobre TODAS as contas.
--   3. Qualquer visitante SEM LOGIN podia LISTAR os arquivos de todas
--      as contas (nome, tamanho, data) e baixá-los.
--
-- O denominador comum dos três é a 044, que fez
-- `GRANT ALL ON ALL TABLES/ROUTINES ... TO anon, authenticated` para
-- resolver um problema de permissão — e, de carona, devolveu tudo o que
-- migrações anteriores tinham fechado de propósito. Um GRANT amplo não
-- avisa o que ele reabriu.
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_platform_admin não pode ser escrita pelo navegador
--
-- A 034 criou este gatilho exatamente para impedir auto-promoção,
-- porque a RLS não sabe restringir COLUNA — `profiles_update` deixa a
-- pessoa editar a própria linha, e "a própria linha" inclui qualquer
-- coluna dela. Na época as colunas perigosas eram account_role e
-- account_id.
--
-- `is_platform_admin` nasceu depois, na 037, e ninguém voltou aqui. O
-- resultado é que a coluna que dá visão de TODAS as contas da
-- plataforma era a única privilegiada sem guarda:
--
--   PATCH /rest/v1/profiles?user_id=eq.<self>  {"is_platform_admin": true}
--
-- ...e a partir daí /api/admin/* devolve as contas de todo mundo, o
-- billing de todo mundo, e os prints de caixa de entrada guardados em
-- platform_events.screenshot — que são conversas de clientes de outra
-- empresa.
--
-- A lição que fica no arquivo: coluna privilegiada nova entra NESTA
-- lista no mesmo commit que a cria.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
        NEW.account_role      IS DISTINCT FROM OLD.account_role
     OR NEW.account_id        IS DISTINCT FROM OLD.account_id
     OR NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     )
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'privilege columns are not self-service'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Cinto além do suspensório: a RLS não expressa coluna, mas o GRANT
-- expressa. Com isto, mesmo que alguém troque a policy por engano no
-- futuro, o UPDATE nas colunas privilegiadas é recusado pelo próprio
-- Postgres, antes de chegar em policy nenhuma.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT  UPDATE (full_name, avatar_url, beta_features)
  ON public.profiles TO authenticated;

-- `anon` não tem o que fazer escrevendo em profiles: quem não está
-- logado não tem linha para editar, e a policy já exigia auth.uid().
-- O GRANT existia só por causa do ALL da 044.

-- ------------------------------------------------------------
-- 2. RPCs internas deixam de ser chamáveis por quem não está logado
--
-- Todas as funções SECURITY DEFINER do schema public estavam com
-- EXECUTE para anon. Duas delas não recebem argumento nenhum e mexem em
-- dado de TODAS as contas de uma vez — bastava a chave anon, que está no
-- bundle de qualquer página:
--
--   POST /rest/v1/rpc/merge_duplicate_contacts
--
-- ...e o banco inteiro tem contatos fundidos e linhas apagadas.
--
-- A lista abaixo é deliberadamente CURTA. Não revogo:
--   - is_account_member / is_platform_admin, que são chamadas DE DENTRO
--     das policies e portanto precisam de EXECUTE pelo papel que
--     consulta — revogá-las quebraria a RLS inteira;
--   - funções de gatilho (handle_new_user, protect_billing_columns,
--     notify_conversation_assigned, os agregadores de broadcast), que
--     não são alcançáveis pelo PostgREST como RPC comum e cujo REVOKE
--     traria risco sem fechar buraco;
--   - peek_invitation, que PRECISA de anon: é ela que faz a página
--     /join dizer "você foi convidado para X" antes do cadastro.
--
-- Fechar o mínimo que resolve é o que torna esta migração segura de
-- aplicar num sábado.
-- ------------------------------------------------------------

-- Destrutivas, sem argumento, cross-conta. As duas piores.
REVOKE EXECUTE ON FUNCTION public.merge_duplicate_contacts()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;

-- Adulteração de cota e de estado alheio: quem souber (ou adivinhar) um
-- uuid queima o orçamento de resposta de outra conta, desativa o webhook
-- de outra conta, ou infla contador de automação.
REVOKE EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_automation_execution_count(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_flow_execution_count(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer)                 FROM PUBLIC, anon, authenticated;

-- Todas as sete acima são chamadas pelo servidor com a chave de serviço
-- (o webhook, os motores de automação/fluxo e o entregador de webhook
-- usam supabaseAdmin()), então este GRANT é o que mantém tudo rodando.
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts()                        TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_conversations()                   TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer)                TO service_role;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer)             TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_automation_execution_count(uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_flow_execution_count(uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer)                  TO service_role;

-- ------------------------------------------------------------
-- 3. Os buckets deixam de ser LISTÁVEIS por quem não está logado
--
-- As três policies de SELECT eram `bucket_id = '<nome>'` e nada mais —
-- valendo para o papel anon. Isso não era só "quem tem a URL lê": a
-- mesma policy governa o endpoint de LISTAGEM, então dava para enumerar
-- as pastas `account-<uuid>/` de todas as contas e depois os nomes,
-- tamanhos e datas de cada arquivo.
--
-- Verificado nesta VPS, sem login nenhum, só com a chave anon pública:
--   POST /storage/v1/object/list/avatars {"prefix":""}
--   -> devolveu a pasta do usuário e, descendo, o nome do arquivo.
--
-- O `chat-media` guarda o que a atendente manda ao cliente — foto,
-- PDF, áudio. Numa ótica, isso é dado de paciente.
--
-- POR QUE OS BUCKETS CONTINUAM `public = true`:
-- a URL pública é o que a META BUSCA para entregar a mídia
-- (upload-media.ts:115 devolve getPublicUrl e o envio manda esse link).
-- O caminho /storage/v1/object/public/... é servido SEM apikey e SEM
-- passar por RLS — confirmado nesta VPS com HTTP 200 e sem credencial.
-- Portanto restringir estas policies mata a enumeração sem quebrar o
-- envio de mídia nem a exibição no app.
--
-- Fica um risco residual conhecido e aceito: quem descobrir a URL exata
-- continua baixando. O caminho é `account-<uuid>/<timestamp>-<nome>`,
-- sem componente aleatório (storage/upload-media.ts:61) — adivinhável
-- por quem já saiba o uuid da conta e o instante do envio. Fechar isso
-- de verdade pede caminho com sufixo aleatório e URL assinada, que é
-- mudança de produto e fica registrada em docs/pendencias.md.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Chat media readable by account members" ON storage.objects;
CREATE POLICY "Chat media readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Flow media readable by account members" ON storage.objects;
CREATE POLICY "Flow media readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Avatares são por USUÁRIO (`<user_id>/avatar-*.png`), não por conta —
-- por isso a condição aqui é outra. Exigir apenas "estar logado" já
-- mata a enumeração anônima, que é o achado; e membros da mesma conta
-- continuam podendo listar, o que o roster de Membros usa.
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Avatars readable by signed-in users" ON storage.objects;
CREATE POLICY "Avatars readable by signed-in users"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars' AND auth.uid() IS NOT NULL);

-- ------------------------------------------------------------
-- Como conferir que pegou (o mesmo teste que provou o buraco):
--
--   -- 1. deve devolver 42501
--   PATCH /rest/v1/profiles?user_id=eq.<self>  {"is_platform_admin": true}
--
--   -- 2. deve devolver 42501 / permission denied
--   POST  /rest/v1/rpc/merge_duplicate_contacts   (com a chave anon)
--
--   -- 3. deve devolver lista vazia
--   POST  /storage/v1/object/list/avatars {"prefix":""}   (com a chave anon)
--
--   -- 4. deve continuar devolvendo 200 e os bytes (a Meta depende disto)
--   GET   /storage/v1/object/public/avatars/<uid>/<arquivo>   (sem credencial)
-- ------------------------------------------------------------
