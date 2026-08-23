// ============================================================
// /api/admin/accounts/[accountId]
//
//   PATCH — set an account's manual billing state (status, paid_until,
//           notes). Platform admin only.
//
// This is the write half of the manual-billing loop: the owner
// invoices out of band, then flips the account here. Migration 037's
// trigger rejects billing-column writes from anything but the service
// role, so this route (and the SQL Editor) are the only paths in.
// ============================================================

import { NextResponse } from "next/server";

import {
  BILLING_STATUSES,
  isBillingStatus,
  requirePlatformAdmin,
  toErrorResponse,
} from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/admin/client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_NOTES_LEN = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();
    const { accountId } = await params;

    const limit = checkRateLimit(
      `admin:billing:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      billingStatus?: unknown;
      paidUntil?: unknown;
      billingNotes?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};

    if (body.billingStatus !== undefined) {
      if (!isBillingStatus(body.billingStatus)) {
        return NextResponse.json(
          {
            error: `'billingStatus' must be one of: ${BILLING_STATUSES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      update.billing_status = body.billingStatus;
    }

    if (body.paidUntil !== undefined) {
      // null clears the date; otherwise require a plain ISO date so a
      // malformed string fails here rather than as a Postgres 500.
      if (body.paidUntil === null || body.paidUntil === "") {
        update.paid_until = null;
      } else if (
        typeof body.paidUntil !== "string" ||
        !ISO_DATE.test(body.paidUntil)
      ) {
        return NextResponse.json(
          { error: "'paidUntil' must be a YYYY-MM-DD date or null" },
          { status: 400 },
        );
      } else {
        update.paid_until = body.paidUntil;
      }
    }

    if (body.billingNotes !== undefined) {
      if (body.billingNotes === null) {
        update.billing_notes = null;
      } else if (typeof body.billingNotes !== "string") {
        return NextResponse.json(
          { error: "'billingNotes' must be a string or null" },
          { status: 400 },
        );
      } else if (body.billingNotes.length > MAX_NOTES_LEN) {
        return NextResponse.json(
          { error: `'billingNotes' must be ${MAX_NOTES_LEN} characters or fewer` },
          { status: 400 },
        );
      } else {
        update.billing_notes = body.billingNotes;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin()
      .from("accounts")
      .update(update)
      .eq("id", accountId)
      .select("id, name, billing_status, paid_until, billing_notes")
      .maybeSingle();

    if (error) {
      console.error("[admin/accounts PATCH] update error:", error);
      return NextResponse.json(
        { error: "Could not update the account" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({
      account: {
        id: data.id,
        name: data.name,
        billingStatus: data.billing_status,
        paidUntil: data.paid_until,
        billingNotes: data.billing_notes,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
