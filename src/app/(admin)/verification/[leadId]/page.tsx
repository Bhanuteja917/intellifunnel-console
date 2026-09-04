import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { computeVerificationSla, resolveAllowedBusinessDays } from "@/lib/leads/sla";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ReviewForm } from "./review-form";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function slaBadgeVariant(breached: boolean, percentElapsed: number): BadgeVariant {
  if (breached) return "destructive";
  if (percentElapsed >= 0.75) return "outline";
  return "secondary";
}

export default async function LeadReviewPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const actor = await requireActor();
  assertPermission(actor, "lead:read");

  // Org-scoping is folded straight into the lookup query (rather than
  // fetched-then-checked with assertOrganizationAccess) so that "not found"
  // and "not this actor's organisation" collapse into the same 404 — no
  // separate ForbiddenError path to handle on a page component.
  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      ...(actor.isInternal
        ? {}
        : { campaignChannel: { campaign: { clientOrganizationId: actor.organizationId } } }),
    },
    include: {
      account: true,
      contact: true,
      campaignChannel: {
        include: { campaign: true, channelTypeVersion: { include: { channelType: true } } },
      },
    },
  });

  if (lead === null) notFound();

  const rejectReasons = await db.rejectReason.findMany({
    where: { isActive: true },
    orderBy: { label: "asc" },
    select: { id: true, code: true, label: true },
  });

  // Live SLA snapshot, computed the same way the queue page (Task 4) does —
  // for display only, never persisted from this page. The decision actions
  // (acceptLeadAction/rejectLeadAction) recompute and persist their own SLA
  // snapshot at the moment of decision.
  const sla = await computeVerificationSla(db, {
    createdAt: lead.createdAt,
    asOf: new Date(),
    allowedBusinessDays: await resolveAllowedBusinessDays(db, lead.campaignChannel.channelTypeVersion),
  });

  // `fieldValuesJson` is a flat Record<string, string> keyed by canonical
  // lead field spec keys (see intake.ts). There is no established wiring
  // from a campaign's QualificationQuestion rows to this JSON blob yet
  // (qualifying-answer evaluation was explicitly out of scope in the prior
  // E8 plan), so this deliberately renders the raw field values as a plain
  // label/value list rather than attempting a question-keyed mapping that
  // doesn't exist.
  const fieldValues = lead.fieldValuesJson as Record<string, string>;
  // Frozen version snapshot, matching the gate decideLeadVerification applies —
  // reading the live row here could show a tele form the server won't require.
  const definition = lead.campaignChannel.channelTypeVersion.definitionJson as Partial<ChannelTypeDefinition> | null;
  const requiresTeleVerification =
    definition?.requiresTeleVerification ?? lead.campaignChannel.channelTypeVersion.channelType.requiresTeleVerification;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/verification"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to queue
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Review lead</h1>
            <p className="text-muted-foreground">{lead.campaignChannel.campaign.name}</p>
          </div>
          <Badge variant={slaBadgeVariant(sla.breached, sla.percentElapsed)}>
            {sla.breached ? "SLA breached" : `SLA ${Math.round(sla.percentElapsed * 100)}% elapsed`}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account &amp; contact</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium">{lead.account.name}</p>
              <p className="text-muted-foreground">
                {[lead.account.industry, lead.account.country].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <div>
              <p className="font-medium">
                {[lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(" ") || lead.contact.email}
              </p>
              <p className="text-muted-foreground">{lead.contact.email}</p>
              <p className="text-muted-foreground">{lead.contact.jobTitle ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submitted field values</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {Object.entries(fieldValues).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell className="font-medium text-muted-foreground">{key}</TableCell>
                    <TableCell>{String(value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ReviewForm
        leadId={lead.id}
        requiresTeleVerification={requiresTeleVerification}
        rejectReasons={rejectReasons}
      />
    </div>
  );
}
