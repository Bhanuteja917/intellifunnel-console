import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import type { LeadVerificationStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SubmissionErrors } from "./submission-errors";
import { LeadsTable, type LeadRow } from "./leads-table";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// LeadSubmission.status (ImportStatus): pending | processing | completed | failed
function submissionStatusVariant(status: string): BadgeVariant {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  return "outline"; // pending | processing
}

const FILTERS = ["all", "accepted", "pending", "rejected"] as const;
type Filter = (typeof FILTERS)[number];

// LeadVerificationStatus: pending | autoValidating | failed | needsReview | passed
const PENDING_STATUSES: LeadVerificationStatus[] = ["pending", "autoValidating", "needsReview"];

function filterWhere(filter: Filter): Prisma.LeadWhereInput {
  if (filter === "accepted") return { verificationStatus: "passed" };
  if (filter === "pending") return { verificationStatus: { in: PENDING_STATUSES } };
  if (filter === "rejected") return { verificationStatus: "failed" };
  return {};
}

export default async function CampaignLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { id } = await params;
  const { filter: rawFilter } = await searchParams;
  const actor = await requireActor();
  const filter: Filter = FILTERS.includes(rawFilter as Filter) ? (rawFilter as Filter) : "all";

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const visibilityScope = actor.isInternal ? {} : { clientVisible: true };

  const [submissions, leads, statusCounts, deliveredCount] = await Promise.all([
    // Submissions (and their per-row errors) expose raw, pre-verification
    // CSV data — an internal-only concern — so this query only runs when
    // the Submissions card below will actually render.
    actor.isInternal
      ? db.leadSubmission.findMany({
          where: { campaignChannel: { campaignId: id } },
          include: { errors: { take: 10 } },
          orderBy: { submittedAt: "desc" },
        })
      : Promise.resolve([]),
    // FR-IN-1: no lead is client-visible before verification passes — a
    // non-internal actor only ever sees clientVisible leads (see
    // src/app/(admin)/campaigns/page.tsx's isInternal precedent).
    db.lead.findMany({
      where: { campaignChannel: { campaignId: id }, ...visibilityScope, ...filterWhere(filter) },
      include: {
        account: true,
        contact: true,
        rejectReason: true,
        submission: { include: { partnerOrganization: { select: { name: true } } } },
        campaignChannel: { select: { channelTypeVersion: { select: { definitionJson: true, version: true } } } },
        consent: { include: { consentTextVersion: { select: { name: true, version: true } } } },
        statusHistory: { orderBy: { changedAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.lead.groupBy({
      by: ["verificationStatus"],
      where: { campaignChannel: { campaignId: id }, ...visibilityScope },
      _count: true,
    }),
    db.lead.count({
      where: { campaignChannel: { campaignId: id }, ...visibilityScope, lifecycleStatus: "delivered" },
    }),
  ]);

  const total = statusCounts.reduce((sum, s) => sum + s._count, 0);
  const accepted = statusCounts.find((s) => s.verificationStatus === "passed")?._count ?? 0;
  const pending = statusCounts
    .filter((s) => ["pending", "autoValidating", "needsReview"].includes(s.verificationStatus))
    .reduce((sum, s) => sum + s._count, 0);
  const rejected = statusCounts.find((s) => s.verificationStatus === "failed")?._count ?? 0;

  // Rejected-per-submission counts, derived from the already-fetched leads
  // (no extra query) — a lead counts as "rejected" if it didn't pass
  // verification, regardless of whether it also produced a LeadSubmissionError.
  const rejectedBySubmissionId = new Map<string, number>();
  for (const lead of leads) {
    if (lead.verificationStatus !== "passed") {
      rejectedBySubmissionId.set(lead.submissionId, (rejectedBySubmissionId.get(lead.submissionId) ?? 0) + 1);
    }
  }

  const canUpload = hasPermission(actor, "campaign:write");

  const leadRows: LeadRow[] = leads.map((lead) => {
    const channelDef = lead.campaignChannel.channelTypeVersion.definitionJson as { code?: string; name?: string };
    return {
      id: lead.id,
      name: [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(" ") || lead.contact.email,
      email: lead.contact.email,
      company: lead.account.name,
      industry: lead.account.industry,
      partner: lead.submission.partnerOrganization?.name ?? "In-house",
      channelLabel: `${channelDef.name ?? channelDef.code ?? "channel"} v${lead.campaignChannel.channelTypeVersion.version}`,
      verificationStatus: lead.verificationStatus,
      lifecycleStatus: lead.lifecycleStatus,
      rejectReason: lead.rejectReason?.label ?? null,
      createdAt: lead.createdAt.toISOString(),
      consentText: lead.consent?.consentTextVersion
        ? `${lead.consent.consentTextVersion.name} v${lead.consent.consentTextVersion.version}`
        : "—",
      fields: Object.entries((lead.fieldValuesJson ?? {}) as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: String(value),
      })),
      timeline: lead.statusHistory.map((h) => ({
        title: `${h.dimension}: ${h.fromValue ? `${h.fromValue} → ` : ""}${h.toValue}`,
        detail: h.reason ?? "",
        when: h.changedAt.toISOString(),
      })),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href={`/campaigns/${campaign.id}` as Route} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to campaign
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <Badge variant="outline">{campaign.code}</Badge>
        <span className="text-muted-foreground">Leads</span>
      </div>

      {actor.isInternal && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Submissions</CardTitle>
          {canUpload && (
            <Button asChild>
              <Link href={`/campaigns/${campaign.id}/leads/upload`}>Upload leads</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Rows (total / staged / failed)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No submissions yet.
                  </TableCell>
                </TableRow>
              )}
              {submissions.map((submission) => {
                const rejectedInSubmission = rejectedBySubmissionId.get(submission.id) ?? 0;
                return (
                <TableRow key={submission.id}>
                  <TableCell>{submission.submittedAt.toISOString().slice(0, 19).replace("T", " ")}</TableCell>
                  <TableCell>{submission.sourceType}</TableCell>
                  <TableCell>
                    {submission.rowsTotal} / {submission.rowsAccepted} / {submission.rowsFailed}
                    {rejectedInSubmission > 0 && (
                      <p className="text-xs text-muted-foreground">{rejectedInSubmission} rejected</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={submissionStatusVariant(submission.status)}>{submission.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {submission.rowsFailed > 0 && (
                      <SubmissionErrors errors={submission.errors} rowsFailed={submission.rowsFailed} />
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      <LeadsTable
        campaignId={campaign.id}
        activeFilter={filter}
        stats={{ total, accepted, pending, rejected, delivered: deliveredCount }}
        leads={leadRows}
      />
    </div>
  );
}
