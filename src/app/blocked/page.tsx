import { redirect } from "next/navigation";

import {
  getCurrentAccount,
  isBillingGated,
  UnauthorizedError,
} from "@/lib/auth/account";
import { BlockedView } from "./blocked-view";

// Manual-billing gate landing page (migration 037). Lives OUTSIDE the
// (dashboard) route group on purpose: the dashboard layout redirects
// gated accounts here, so this page must not render the shell (nav,
// sidebar) that a gated account is barred from.
//
// Uses `allowBlocked` — this is one of the few callers that must
// resolve the account context precisely when the 402 gate would fire,
// so it can tell the user WHICH account is gated and WHY.
export default async function BlockedPage() {
  let name: string;
  let status: "pending" | "blocked";

  try {
    const ctx = await getCurrentAccount({ allowBlocked: true });
    if (!isBillingGated(ctx.account.billingStatus)) {
      // Not actually gated (paid up / just approved) — nothing to see.
      redirect("/dashboard");
    }
    name = ctx.account.name;
    status = ctx.account.billingStatus as "pending" | "blocked";
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw err;
  }

  return (
    <BlockedView
      accountName={name}
      status={status}
      contact={process.env.NEXT_PUBLIC_BILLING_CONTACT ?? null}
      pixKey={process.env.NEXT_PUBLIC_BILLING_PIX_KEY ?? null}
      pixQr={process.env.NEXT_PUBLIC_BILLING_PIX_QR ?? null}
    />
  );
}
