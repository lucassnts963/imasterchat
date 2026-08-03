import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/admin/client'
import { TERMS_VERSION } from '@/lib/legal/terms'

// ============================================================
// POST /api/terms/accept — registra o aceite de quem está logado
// GET  /api/terms/accept — já aceitou a versão em vigor?
//
// O aceite é gravado AQUI e não pelo navegador porque duas das três
// coisas que fazem dele uma prova — o instante e a origem — não podem
// vir de quem está sendo registrado. O cliente só informa que clicou; o
// resto o servidor observa.
//
// A versão também é do servidor. Aceitar `{"version": "1999-01-01"}`
// deixaria qualquer um registrar aceite de um texto que nunca existiu.
//
// Não usa `getCurrentAccount`: no cadastro o perfil e a conta podem
// ainda não existir quando isto roda. O que precisa existir é a sessão,
// e é só isso que se exige.
// ============================================================

/**
 * IP do cliente, na melhor aproximação disponível.
 *
 * `CF-Connecting-IP` primeiro: a Cloudflare reescreve esse header a
 * cada requisição, enquanto `X-Forwarded-For` ela apenas ACRESCENTA —
 * quem manda `X-Forwarded-For: 1.2.3.4` faz a lista chegar como
 * "1.2.3.4, <ip real>" e a leitura pela esquerda pega o valor forjado.
 * Mesma correção que as rotas de convite levaram.
 */
function clientIp(request: Request): string | null {
  const cf = request.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() ?? null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data } = await supabase
    .from('terms_acceptances')
    .select('version, accepted_at')
    .eq('user_id', user.id)
    .eq('version', TERMS_VERSION)
    .maybeSingle<{ version: string; accepted_at: string }>()

  return NextResponse.json({
    version: TERMS_VERSION,
    accepted: Boolean(data),
    accepted_at: data?.accepted_at ?? null,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // `ON CONFLICT DO NOTHING`: reenviar não sobrescreve a data do aceite
  // ORIGINAL, que é justamente a que se quer provar. Um F5 na tela de
  // cadastro não pode reescrever quando a pessoa concordou.
  const { error } = await supabaseAdmin()
    .from('terms_acceptances')
    .upsert(
      {
        user_id: user.id,
        version: TERMS_VERSION,
        ip: clientIp(request),
        user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      },
      { onConflict: 'user_id,version', ignoreDuplicates: true },
    )

  if (error) {
    // Falhar aqui NÃO derruba o cadastro de quem já criou a conta — o
    // aceite é recuperável na próxima visita, e travar alguém na porta
    // por causa de um INSERT seria pior. Fica alto no log porque é uma
    // lacuna de prova, não um detalhe.
    console.error('[terms/accept] insert failed:', error)
    return NextResponse.json({ error: 'not_recorded' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, version: TERMS_VERSION })
}
