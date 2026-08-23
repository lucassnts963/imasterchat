-- ============================================================
-- Quem aceitou os termos, quando, e QUAL versão
--
-- Até aqui não havia nem a pergunta nem a resposta: o formulário de
-- cadastro não mencionava os termos, e nada era gravado. A página de
-- termos afirmava "ao criar uma conta você concorda" — o que é uma
-- alegação, não uma prova. Se um cliente disser "nunca aceitei isso",
-- não havia o que mostrar.
--
-- Tabela própria, e não uma coluna em `profiles`, por causa da VERSÃO:
-- termos mudam, e o que importa provar é qual texto a pessoa leu
-- naquele dia. Uma coluna guardaria só o último aceite e apagaria a
-- história justamente quando ela vira o assunto.
--
-- Append-only por política: sem UPDATE e sem DELETE. Um registro de
-- aceite que pode ser editado depois não vale como registro. Nem o dono
-- da conta apaga o próprio — a exclusão de dados do titular, quando
-- pedida, é feita pelo operador com a chave de serviço, que é onde esse
-- tipo de decisão deve passar.
--
-- `ip` e `user_agent` ficam porque são o que distingue um aceite de uma
-- linha que alguém inseriu. São dados pessoais e entram na política de
-- retenção junto com o resto da conta.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- A data de publicação do texto, no formato AAAA-MM-DD. Casa com a
  -- constante TERMS_VERSION do app; se as duas divergirem, o app pede
  -- o aceite de novo, que é o comportamento seguro.
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  CONSTRAINT terms_acceptances_version_check
    CHECK (char_length(btrim(version)) BETWEEN 1 AND 40)
);

-- Um aceite por pessoa por versão. Reenviar é idempotente em vez de
-- empilhar linhas iguais — e o `ON CONFLICT DO NOTHING` do app depende
-- deste índice para não sobrescrever a data do aceite ORIGINAL, que é
-- exatamente a que se quer provar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptances_user_version
  ON public.terms_acceptances (user_id, version);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_accepted_at
  ON public.terms_acceptances (accepted_at DESC);

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Cada um enxerga o próprio aceite. Não há política de UPDATE nem de
-- DELETE, de propósito: com RLS ligada, o que não tem política é
-- negado, e é assim que "append-only" deixa de depender de disciplina.
DROP POLICY IF EXISTS terms_acceptances_select_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select_own ON public.terms_acceptances
  FOR SELECT USING (user_id = auth.uid());

-- O INSERT também é só do próprio, mas quem grava de verdade é a rota
-- com a chave de serviço — ela é que sabe o IP e o user agent, e o
-- cliente não pode ser a fonte de nenhum dos dois.
DROP POLICY IF EXISTS terms_acceptances_insert_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_insert_own ON public.terms_acceptances
  FOR INSERT WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.terms_acceptances IS
  'Registro append-only de aceite dos Termos de Uso. Uma linha por '
  'usuário por versão do texto. Sem UPDATE e sem DELETE por ausência '
  'de política RLS — um aceite editável não prova nada.';
