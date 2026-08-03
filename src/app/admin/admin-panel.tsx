"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { BILLING_STATUSES, type BillingStatus } from "@/lib/billing/status";
import { LogoBadge } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AdminAccountRow {
  id: string;
  name: string;
  billingStatus: BillingStatus;
  paidUntil: string | null;
  billingNotes: string | null;
  createdAt: string;
  ownerEmail: string | null;
  memberCount: number;
}

// Colors mirror the semantics in migration 037: gated states read as
// warning/destructive, healthy ones as neutral/primary.
const STATUS_CLASS: Record<BillingStatus, string> = {
  pending: "text-amber-500",
  active: "text-emerald-500",
  past_due: "text-amber-500",
  blocked: "text-destructive",
};

export function AdminAccountsPanel() {
  const t = useTranslations("Billing.admin");
  const [rows, setRows] = useState<AdminAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  // Notes are edited locally and committed on blur so every keystroke
  // isn't a PATCH.
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/accounts");
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setRows(json.accounts ?? []);
    } catch {
      toast.error(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setSavingId(id);
      try {
        const res = await fetch(`/api/admin/accounts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...json.account } : r)),
        );
        toast.success(t("updatedToast"));
      } catch {
        toast.error(t("updateError"));
      } finally {
        setSavingId(null);
      }
    },
    [t],
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center gap-3">
          <LogoBadge />
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </header>

        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colAccount")}</TableHead>
                <TableHead>{t("colOwner")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colPaidUntil")}</TableHead>
                <TableHead className="text-right">{t("colMembers")}</TableHead>
                <TableHead>{t("colNotes")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-foreground">
                    {row.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.ownerEmail ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.billingStatus}
                      onValueChange={(v) =>
                        patch(row.id, { billingStatus: v as BillingStatus })
                      }
                      disabled={savingId === row.id}
                    >
                      <SelectTrigger
                        className={`w-44 ${STATUS_CLASS[row.billingStatus]}`}
                      >
                        <SelectValue>
                          {(v) =>
                            STATUS_LABEL_KEY[v as BillingStatus]
                              ? t(STATUS_LABEL_KEY[v as BillingStatus])
                              : String(v ?? '')
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {BILLING_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(STATUS_LABEL_KEY[s])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      className="w-40"
                      defaultValue={row.paidUntil ?? ""}
                      disabled={savingId === row.id}
                      onBlur={(e) => {
                        const next = e.target.value || null;
                        if (next !== row.paidUntil) {
                          void patch(row.id, { paidUntil: next });
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {row.memberCount}
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder={t("notesPlaceholder")}
                      value={noteDraft[row.id] ?? row.billingNotes ?? ""}
                      disabled={savingId === row.id}
                      onChange={(e) =>
                        setNoteDraft((d) => ({ ...d, [row.id]: e.target.value }))
                      }
                      onBlur={() => {
                        const draft = noteDraft[row.id];
                        if (draft !== undefined && draft !== (row.billingNotes ?? "")) {
                          void patch(row.id, { billingNotes: draft });
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!loading && rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : null}
        </div>

        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {t("refresh")}
        </Button>
      </div>
    </div>
  );
}

const STATUS_LABEL_KEY: Record<BillingStatus, string> = {
  pending: "statusPending",
  active: "statusActive",
  past_due: "statusPastDue",
  blocked: "statusBlocked",
};
