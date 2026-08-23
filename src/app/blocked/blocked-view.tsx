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
  /** PIX QR code image — base64 PNG, with or without a data: prefix. */
  pixQr: string | null;
}

// Accepts the raw base64 the operator pasted into the env var either
// bare or already as a data URI; anything else (e.g. an http URL by
// mistake) is dropped so we never emit a broken/foreign <img src>.
function pixQrSrc(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.startsWith("data:image/")) return v;
  if (/^[A-Za-z0-9+/=\s]+$/.test(v)) {
    return `data:image/png;base64,${v.replace(/\s/g, "")}`;
  }
  return null;
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
  pixQr,
}: BlockedViewProps) {
  const t = useTranslations("Billing");
  const pending = status === "pending";
  const qrSrc = pixQrSrc(pixQr);

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
          {!pending && (pixKey || qrSrc) ? (
            <div className="rounded-lg border border-border bg-card-2 p-3 text-center">
              {qrSrc ? (
                <>
                  {/* White frame so phone cameras can read it on the
                      dark theme — QR readers need light quiet zones. */}
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      src is an inline data URI; next/image adds nothing */}
                  <img
                    src={qrSrc}
                    alt={t("pixQrAlt")}
                    className="mx-auto mb-3 h-44 w-44 rounded-md bg-white p-2"
                  />
                </>
              ) : null}
              {pixKey ? (
                <>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("pixLabel")}
                  </div>
                  <code className="text-sm font-mono break-all">{pixKey}</code>
                </>
              ) : null}
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
