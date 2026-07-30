import { redirect } from "next/navigation";

import {
  getCurrentAccount,
  UnauthorizedError,
  PaymentRequiredError,
} from "@/lib/auth/account";
import { AdminAccountsPanel } from "./admin-panel";

// Platform-admin surface. Lives OUTSIDE the (dashboard) route group:
// it is not tenant-scoped chrome, and its own layout must not run the
// billing gate that the dashboard layout applies.
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

  return <AdminAccountsPanel />;
}
