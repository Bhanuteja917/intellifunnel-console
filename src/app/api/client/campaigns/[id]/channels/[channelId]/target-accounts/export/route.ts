import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { exportTargetAccountListCsv } from "@/lib/lists/target-accounts";
import { ApplicationError, NotFoundError } from "@/lib/errors";

function statusForError(error: ApplicationError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 400;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> },
): Promise<Response> {
  const { id: campaignId, channelId } = await params;

  try {
    const actor = await requireActor();
    assertPortal(actor, "client");

    // Same org-ownership guard getClientChannelDetail uses
    // (src/lib/approvals/client-channel-view.ts) — this is a distinct
    // request, so it re-checks rather than trusting a link rendered earlier.
    const channel = await db.campaignChannel.findFirst({
      where: {
        id: channelId,
        campaignId,
        campaign: { clientOrganizationId: actor.organizationId, deletedAt: null, status: { not: "draft" } },
      },
      select: { id: true },
    });
    if (channel === null) throw new NotFoundError("Channel not found");

    const csv = await exportTargetAccountListCsv(db, actor, channelId);
    if (csv === null) throw new NotFoundError("No target account list attached to this channel");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="target-accounts-${channelId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.message }, { status: statusForError(error) });
    }
    throw error;
  }
}
