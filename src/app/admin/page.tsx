import { redirect } from "next/navigation";

import {
  getCurrentAccount,
  UnauthorizedError,
  PaymentRequiredError,
} from "@/lib/auth/account";
import { AdminAccountsPanel } from "./admin-panel";
import { PricingPanel } from "./pricing-panel";

// Platform-admin surface. Lives OUTSIDE the (dashboard) route group so
// it does not inherit that group's manual-billing gate — a platform
// admin whose own account is blocked still has to reach the panel that
// unblocks accounts. It shares the chrome through its own layout, so
// staying out of the group costs nothing visually.
//
// Access is enforced twice on purpose — here so a non-admin never
// renders the page, and again inside every /api/admin route, which is
// what actually protects the data (the page is just a client of it).
export default async function AdminPage() {
  try {
    const ctx = await getCurrentAccount({ allowBlocked: true });
    if (!ctx.isPlatformAdmin) redirect("/dashboard");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/login");
    if (err instanceof PaymentRequiredError) redirect("/blocked");
    throw err;
  }

  return (
    <div className="space-y-6">
      <AdminAccountsPanel />
      {/* Prices and the dollar are platform facts, not account
          settings — one shop's typo must not become another's
          budget. This is the only screen gated on is_platform_admin. */}
      <PricingPanel />
    </div>
  );
}
