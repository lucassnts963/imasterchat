// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * The caller's account is gated by manual billing — either a fresh
 * signup awaiting approval (`pending`) or an account suspended for
 * non-payment (`blocked`). Maps to HTTP 402 so API clients can
 * distinguish "pay/approve first" from auth (401) and role (403)
 * failures. The dashboard layout catches this and redirects to
 * /blocked.
 */
export class PaymentRequiredError extends Error {
  readonly status = 402 as const;
  constructor(
    readonly billingStatus: BillingStatus,
    message = "Account access is suspended",
  ) {
    super(message);
    this.name = "PaymentRequiredError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof UnauthorizedError ||
    err instanceof ForbiddenError ||
    err instanceof PaymentRequiredError
  ) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

/**
 * Manual-billing state of an account. Mirrors the Postgres
 * `billing_status_enum` from migration 037. `pending` and `blocked`
 * are the gated states; `active` and `past_due` have full access
 * (`past_due` additionally shows a warning banner client-side).
 */
export const BILLING_STATUSES = [
  "pending",
  "active",
  "past_due",
  "blocked",
] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export function isBillingStatus(value: unknown): value is BillingStatus {
  return (
    typeof value === "string" &&
    (BILLING_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

/** The two statuses that deny dashboard/API access. */
export function isBillingGated(status: BillingStatus): boolean {
  return status === "pending" || status === "blocked";
}

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name + manual billing state. */
  account: { id: string; name: string; billingStatus: BillingStatus };
  /** Cross-tenant platform-admin flag (profiles.is_platform_admin). */
  isPlatformAdmin: boolean;
}

export interface GetCurrentAccountOptions {
  /**
   * Resolve the context even when the account is billing-gated
   * (`pending` / `blocked`). Only the /blocked page, the admin
   * surface, and logout should pass this — every ordinary route
   * wants the default throw-402 behavior.
   */
  allowBlocked?: boolean;
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(
  options: GetCurrentAccountOptions = {},
): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role, is_platform_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, billing_status")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  // Manual-billing gate (migration 037). Rows that predate the
  // migration can't reach here — deploying this version requires 037
  // — but a NULL from a hand-inserted row degrades to 'active' rather
  // than locking the tenant out over missing metadata.
  const billingStatus: BillingStatus = isBillingStatus(account.billing_status)
    ? account.billing_status
    : "active";
  if (isBillingGated(billingStatus) && !options.allowBlocked) {
    throw new PaymentRequiredError(
      billingStatus,
      billingStatus === "pending"
        ? "Account is awaiting approval"
        : "Account access is suspended",
    );
  }

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: { id: account.id, name: account.name, billingStatus },
    isPlatformAdmin: data.is_platform_admin === true,
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(
  min: AccountRole,
  options: GetCurrentAccountOptions = {},
): Promise<AccountContext> {
  const ctx = await getCurrentAccount(options);
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}

/**
 * Resolve the caller's context and require the cross-tenant
 * platform-admin flag (profiles.is_platform_admin, migration 037).
 * Used by the /admin panel and /api/admin routes. Passes
 * `allowBlocked` so the platform owner can administer accounts even
 * if their own account were ever gated.
 */
export async function requirePlatformAdmin(): Promise<AccountContext> {
  const ctx = await getCurrentAccount({ allowBlocked: true });
  if (!ctx.isPlatformAdmin) {
    throw new ForbiddenError("Platform admin access required");
  }
  return ctx;
}
