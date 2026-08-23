// ============================================================
// Manual-billing status — the shared vocabulary.
//
// Deliberately dependency-free so BOTH sides of the React boundary
// can import it. `@/lib/auth/account` (which re-exports these) pulls
// in the Supabase SSR client and therefore `next/headers`, so a client
// component importing the enum from there fails the build. Anything
// client-side — the admin panel, banners — imports from here.
//
// Mirrors the Postgres `billing_status_enum` from migration 037.
// ============================================================

export const BILLING_STATUSES = [
  /** Fresh signup awaiting manual approval — gated. */
  "pending",
  /** Paying (or approved) account — full access. */
  "active",
  /** Invoice aging — full access, plus a warning banner. */
  "past_due",
  /** Suspended for non-payment — gated. */
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
