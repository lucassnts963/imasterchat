-- ============================================================
-- Rodízio de verdade.
--
-- O modo "round_robin" que existia no passo de automação fazia
-- `SELECT user_id FROM profiles WHERE account_id = X LIMIT 1` — sem
-- ORDER BY e sem memória do último. Não era rodízio: era "qualquer um",
-- e na prática quase sempre a mesma pessoa. O rótulo já foi corrigido na
-- onda 0; isto aqui é a coisa.
--
-- ------------------------------------------------------------
-- O PROBLEMA REAL NÃO É ESCOLHER, É A CORRIDA
--
-- Escolher a próxima pessoa é trivial. O que quebra é isto: duas
-- mensagens entram no mesmo instante para a mesma fila, ambas leem "o
-- último foi a Ana", ambas escolhem o Bruno. O rodízio desaparece
-- exatamente no pico — que é quando ele importa.
--
-- A correção não é trava na aplicação: é fazer o AVANÇO DO CURSOR SER A
-- TRAVA. O `UPDATE ... RETURNING` abaixo bloqueia a linha da fila; um
-- segundo chamador espera ali até o primeiro commitar, e nunca leem o
-- mesmo cursor. Sai de graça, porque o cursor já precisava avançar.
--
-- A ordem dos membros precisa ser DETERMINÍSTICA (position, user_id).
-- Sem isso a sequência muda a cada consulta e deixa de ser rodízio —
-- que é, palavra por palavra, o defeito que estamos consertando.
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_queue_assignee(p_queue_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue        public.queues%ROWTYPE;
  v_n            bigint;
  v_eligible     uuid[];
  v_count        integer;
  v_user         uuid;
BEGIN
  -- O UPDATE vem PRIMEIRO e é o que serializa. Fazer a leitura antes
  -- devolveria o mesmo estado para dois chamadores simultâneos.
  UPDATE public.queues
     SET rr_cursor = rr_cursor + 1
   WHERE id = p_queue_id
  RETURNING * INTO v_queue;

  IF v_queue.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_n := v_queue.rr_cursor;

  -- Quem está na roda: membros ativos, em ordem estável, pulando quem
  -- está offline quando a fila pede isso.
  --
  -- O corte de presença é 75s porque é o mesmo que a interface usa
  -- (lib/presence.ts): a batida é a cada 30s, e três batidas perdidas já
  -- significam alguém que fechou o navegador.
  SELECT array_agg(qm.user_id ORDER BY qm.position, qm.user_id)
    INTO v_eligible
    FROM public.queue_members qm
    LEFT JOIN public.member_presence mp ON mp.user_id = qm.user_id
   WHERE qm.queue_id = p_queue_id
     AND qm.active
     AND (
       NOT v_queue.skip_offline
       OR (mp.last_seen_at IS NOT NULL
           AND mp.last_seen_at > now() - interval '75 seconds')
     );

  v_count := COALESCE(array_length(v_eligible, 1), 0);

  -- Ninguém disponível.
  --
  -- Cair no responsável seria o reflexo errado: se a fila pediu para
  -- pular offline e TODO MUNDO está offline, atribuir ao responsável
  -- (que também está offline) esconde o problema. Devolver NULL deixa a
  -- conversa NA FILA, visível e esperando — e é o relógio do SLA que
  -- cobra. Atribuir para quem foi embora é pior que não atribuir.
  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_queue.distribution = 'least_busy' THEN
    -- Menos conversas abertas atribuídas. Empate desempata pelo
    -- user_id, para a escolha ser reproduzível.
    SELECT u INTO v_user
      FROM unnest(v_eligible) AS u
      LEFT JOIN public.conversations c
             ON c.assigned_agent_id = u
            AND c.status IN ('open', 'pending')
     GROUP BY u
     ORDER BY count(c.id), u
     LIMIT 1;
    RETURN v_user;
  END IF;

  -- Rodízio. O cursor é uma POSIÇÃO, não um ponteiro para pessoa: entrar
  -- ou sair gente desloca a sequência uma vez, o que é aceitável — o
  -- efeito é uma volta ligeiramente desigual quando a equipe muda.
  RETURN v_eligible[((v_n - 1) % v_count) + 1];
END $$;

REVOKE EXECUTE ON FUNCTION public.next_queue_assignee(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_queue_assignee(uuid) TO service_role;

COMMENT ON FUNCTION public.next_queue_assignee(uuid) IS
  'Próxima pessoa da fila, por rodízio ou menos-ocupado. O UPDATE do '
  'cursor é a trava que serializa chamadas simultâneas — sem ele, duas '
  'mensagens no mesmo instante escolhem a mesma pessoa e o rodízio '
  'desaparece justamente no pico. NULL = ninguém disponível: a conversa '
  'fica na fila, visível, em vez de ir para quem foi embora.';
