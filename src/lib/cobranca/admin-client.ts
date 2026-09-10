import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente de service-role da régua de cobrança. Mesma forma dos de
// automações e de fluxos, para quem ler qualquer um dos três reconhecer
// a convenção na hora.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
