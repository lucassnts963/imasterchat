import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the platform-admin surface.
// Mirrors src/lib/flows/admin-client.ts and
// src/lib/automations/admin-client.ts — same shape so anyone reading
// any of the three picks up the convention immediately.
//
// This is the ONLY way the /admin routes can read across tenants: RLS
// scopes every accounts query to the caller's own account
// (is_account_member), so a session-scoped client would return exactly
// one row no matter who asks. Callers MUST gate on
// requirePlatformAdmin() before touching this client.
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
