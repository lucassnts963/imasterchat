import { redirect } from "next/navigation";

import {
  getCurrentAccount,
  UnauthorizedError,
  PaymentRequiredError,
} from "@/lib/auth/account";
import { AdminTabs } from "./admin-tabs";

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

  // Prices and the dollar are platform facts, not account settings —
  // one shop's typo must not become another's budget. Both live behind
  // this is_platform_admin gate, in tabs rather than stacked: the
  // accounts table fills the viewport by itself, and anything under it
  // is invisible in practice.
  return <AdminTabs />;
}
