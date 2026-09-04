import Link from "next/link";
import type { Route } from "next";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { computeVerificationSla } from "@/lib/leads/sla";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { QueueRowActions } from "./queue-row-actions";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const { campaignId } = await searchParams;
  const actor = await requireActor();
  assertPermission(actor, "lead:read");

  // Both the org-scoping clause and the campaignId clause target the same
  // top-level `campaignChannel` key in the Prisma `where`. They must be
  // merged into ONE object here — two separate top-level spreads that both
  // write `campaignChannel` would have the second silently clobber the
  // first (shallow spread), dropping the org check entirely whenever a
  // campaignId was also present.
  const campaignChannelFilter = {
    ...(actor.isInternal ? {} : { campaign: { clientOrganizationId: actor.organizationId } }),
    ...(campaignId ? { campaignId } : {}),
  };

  const leads = await db.lead.findMany({
    where: {
      verificationStatus: "needsReview",
      ...(Object.keys(campaignChannelFilter).length > 0 ? { campaignChannel: campaignChannelFilter } : {}),
    },
    include: {
      account: true,
      contact: true,
      campaignChannel: { include: { campaign: true, channelTypeVersion: { include: { channelType: true } } } },
    },
    orderBy: { createdAt: "asc" }, // oldest first — the queue's whole point is age-ordering
    take: 50,
  });

  // Campaigns visible to the actor that currently have at least one
  // needsReview lead — the filter's option list, kept simple per the plan
  // (no distinct-query cleverness, just dedupe the fetched rows' campaigns).
  const campaignsWithNeedsReview = await db.campaign.findMany({
    where: {
      ...(actor.isInternal ? {} : { clientOrganizationId: actor.organizationId }),
      channels: { some: { leads: { some: { verificationStatus: "needsReview" } } } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Batch-resolve assignedToUserId -> display name/email in one query,
  // rather than one query per row.
  const assignedUserIds = [...new Set(leads.map((lead) => lead.assignedToUserId).filter((id): id is string => id !== null))];
  const assignedUsers = assignedUserIds.length > 0
    ? await db.user.findMany({ where: { id: { in: assignedUserIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userById = new Map(assignedUsers.map((user) => [user.id, user]));

  function slaBadgeVariant(breached: boolean, percentElapsed: number): BadgeVariant {
    if (breached) return "destructive";
    if (percentElapsed >= 0.75) return "outline";
    return "secondary";
  }

  const rows = await Promise.all(
    leads.map(async (lead) => {
      const sla = await computeVerificationSla(db, {
        createdAt: lead.createdAt,
        asOf: new Date(),
        channelTypeId: lead.campaignChannel.channelTypeVersion.channelType.id,
      });
      const assignedUser = lead.assignedToUserId !== null ? userById.get(lead.assignedToUserId) : undefined;
      return { lead, sla, assignedUser };
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verification queue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex items-center gap-2" action="/verification">
          <label htmlFor="campaignId" className="text-sm text-muted-foreground">
            Campaign
          </label>
          <select
            id="campaignId"
            name="campaignId"
            defaultValue={campaignId ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All campaigns</option>
            {campaignsWithNeedsReview.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-md border border-input px-3 text-sm hover:bg-muted"
          >
            Filter
          </button>
        </form>

        {rows.length === 0 ? (
          <Alert>
            <AlertTitle>Nothing awaiting verification.</AlertTitle>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Contact email</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ lead, sla, assignedUser }) => (
                <TableRow
                  key={lead.id}
                  className={cn(sla.breached && "bg-destructive/5")}
                >
                  <TableCell>{lead.campaignChannel.campaign.name}</TableCell>
                  <TableCell>{lead.account.name}</TableCell>
                  <TableCell>{lead.contact.email}</TableCell>
                  <TableCell>
                    {assignedUser ? `${assignedUser.name} (${assignedUser.email})` : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={slaBadgeVariant(sla.breached, sla.percentElapsed)}>
                      {sla.breached ? "Breached" : `${Math.round(sla.percentElapsed * 100)}%`}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {lead.assignedToUserId === null ? (
                      <QueueRowActions leadId={lead.id} />
                    ) : lead.assignedToUserId === actor.userId ? (
                      // Task 6's review page doesn't exist yet, hence the cast.
                      <Link href={`/verification/${lead.id}` as Route} className="text-sm underline underline-offset-4">
                        Review
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
