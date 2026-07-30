// ============================================================
// /api/admin/accounts
//
//   GET — every account on the platform with its manual billing
//         state, the owner's email, and a member count.
//         Platform admin only.
//
// Cross-tenant by definition, so this route reads through the
// service-role client (src/lib/admin/client.ts): RLS scopes an
// ordinary session to the caller's own account, which would return
// exactly one row here. The service-role client bypasses RLS, so
// requirePlatformAdmin() below is the ONLY thing standing between a
// signed-in user and every tenant's metadata — it runs first, and
// nothing touches supabaseAdmin() before it resolves.
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformAdmin, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/admin/client";

export interface AdminAccountRow {
  id: string;
  name: string;
  billingStatus: string;
  paidUntil: string | null;
  billingNotes: string | null;
  createdAt: string;
  ownerEmail: string | null;
  memberCount: number;
}

export async function GET() {
  try {
    await requirePlatformAdmin();

    const admin = supabaseAdmin();

    const { data: accounts, error } = await admin
      .from("accounts")
      .select("id, name, billing_status, paid_until, billing_notes, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin/accounts] accounts fetch error:", error);
      return NextResponse.json(
        { error: "Could not load accounts" },
        { status: 500 },
      );
    }

    // Profiles carry both the membership (account_id) and the email, so
    // one pass over them yields the owner email and the member count
    // without an N+1 per account.
    const { data: profiles, error: profilesErr } = await admin
      .from("profiles")
      .select("account_id, account_role, email");

    if (profilesErr) {
      console.error("[admin/accounts] profiles fetch error:", profilesErr);
      return NextResponse.json(
        { error: "Could not load accounts" },
        { status: 500 },
      );
    }

    const counts = new Map<string, number>();
    const owners = new Map<string, string | null>();
    for (const p of profiles ?? []) {
      if (!p.account_id) continue;
      counts.set(p.account_id, (counts.get(p.account_id) ?? 0) + 1);
      if (p.account_role === "owner") owners.set(p.account_id, p.email ?? null);
    }

    const rows: AdminAccountRow[] = (accounts ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      billingStatus: a.billing_status,
      paidUntil: a.paid_until,
      billingNotes: a.billing_notes,
      createdAt: a.created_at,
      ownerEmail: owners.get(a.id) ?? null,
      memberCount: counts.get(a.id) ?? 0,
    }));

    return NextResponse.json({ accounts: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
