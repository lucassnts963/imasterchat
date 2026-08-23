import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAccount, PaymentRequiredError } from "@/lib/auth/account";
import { AppShell } from "@/components/layout/app-shell";
import { FeedbackWidget } from "@/components/feedback/feedback-widget";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
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

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Manual-billing gate (migration 037): a pending/blocked account
  // must not render the dashboard. API routes already 402 via
  // toErrorResponse; this is the page-level counterpart. Middleware
  // stays dumb (no DB round trip per request) — the gate lives here,
  // where the account row is loaded anyway. Auth errors fall through
  // to the existing client-side redirect in AppShell and the
  // middleware guard, so only the billing case is handled.
  try {
    await getCurrentAccount();
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      redirect("/blocked");
    }
  }

  return (
    <AppShell>
      {children}
      {/* Fora do <main>: é um botão flutuante e não deve entrar no
          fluxo de nenhuma tela nem no scroll delas. */}
      <FeedbackWidget />
    </AppShell>
  );
}
