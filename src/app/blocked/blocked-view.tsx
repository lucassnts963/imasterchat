"use client";

import { useTranslations } from "next-intl";
import { CircleAlert, Clock, LogOut, MessageSquare } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BlockedViewProps {
  accountName: string;
  status: "pending" | "blocked";
  /** Support contact — a URL (wa.me / mailto) or plain text. */
  contact: string | null;
  /** PIX key shown for manual payment. */
  pixKey: string | null;
}

// Client half of the /blocked page: translated copy + sign-out. The
// AuthProvider only mounts inside the (dashboard) shell, so sign-out
// here talks to the browser Supabase client directly, mirroring
// use-auth's signOut.
export function BlockedView({
  accountName,
  status,
  contact,
  pixKey,
}: BlockedViewProps) {
  const t = useTranslations("Billing");
  const pending = status === "pending";

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const contactIsLink =
    contact !== null && /^(https?:|mailto:|tel:)/.test(contact);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div
            className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${
              pending ? "bg-primary-soft" : "bg-destructive/15"
            }`}
          >
            {pending ? (
              <Clock className="h-6 w-6 text-primary" />
            ) : (
              <CircleAlert className="h-6 w-6 text-destructive" />
            )}
          </div>
          <CardTitle>
            {pending ? t("pendingTitle") : t("blockedTitle")}
          </CardTitle>
          <CardDescription>
            {pending
              ? t("pendingDesc", { accountName })
              : t("blockedDesc", { accountName })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pending && pixKey ? (
            <div className="rounded-lg border border-border bg-card-2 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {t("pixLabel")}
              </div>
              <code className="text-sm font-mono break-all">{pixKey}</code>
            </div>
          ) : null}

          {contact ? (
            contactIsLink ? (
              <a
                href={contact}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ className: "w-full" })}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                {t("contactCta")}
              </a>
            ) : (
              <div className="text-center text-sm text-muted-foreground">
                {t("contactCta")}: {contact}
              </div>
            )
          ) : null}

          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            {t("signOut")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
