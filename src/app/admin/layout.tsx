import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";

// The platform-admin panel gets the same chrome as the rest of the app —
// sidebar, header, the entry highlighted in the nav — because it is part
// of the app. Rendering it bare made it read as having left iMasterChat,
// which is disorienting for a screen an operator reaches from that very
// sidebar.
//
// What it deliberately does NOT inherit is the (dashboard) group's
// manual-billing gate. That gate redirects a pending or blocked account
// to /blocked, and a platform admin whose own account is blocked is
// exactly the person who needs to reach the panel that unblocks
// accounts. Locking them out of it would be a trap with no way back.
//
// Access is still enforced twice: page.tsx refuses a non-admin, and
// every /api/admin route re-checks — the page is only a client of them.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
