import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { hasPermission } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings/settings";
import { expectedToDate, paceSignal } from "@/lib/allocations/pacing";
import { fromMinorUnits } from "@/lib/money/currency";
import { loadChannelReadiness } from "@/lib/channels/readiness";
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
import { AddChannelDialog } from "./add-channel-dialog";
import { ApprovalActions } from "./approval-actions";
import { IcpCriteriaEditor } from "./icp-criteria-editor";
import { LeadFieldSpecEditor } from "./lead-field-spec-editor";

function statCard(label: string, value: string, hint: string) {
  return (
    <Card key={label}>
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canEditConfig = hasPermission(actor, "campaign:write") && campaign.status === "draft";
  const canReadAssets = hasPermission(actor, "asset:read");
  const canReadAllocations = hasPermission(actor, "allocation:read");
  const canReadDelivery = hasPermission(actor, "delivery:read");

  const [channelTypes, timeZone] = await Promise.all([
    canEditConfig
      ? db.channelType.findMany({
          where: { isActive: true, currentVersion: { gt: 0 } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    getSetting(db, "operatingTimezone"),
  ]);

  const now = new Date();
  const readiness = await Promise.all(
    campaign.channels.map(async (channel) => {
      const [placementsCount, allocationsAgg, deliveryConfigured] = await Promise.all([
        canReadAssets ? db.assetPlacement.count({ where: { campaignChannelId: channel.id } }) : Promise.resolve(0),
        canReadAllocations
          ? db.partnerAllocation.aggregate({
              where: { campaignChannelId: channel.id },
              _sum: { allocatedQuantity: true },
              _count: true,
            })
          : Promise.resolve({ _sum: { allocatedQuantity: null }, _count: 0 }),
        canReadDelivery ? db.deliveryConfig.count({ where: { campaignChannelId: channel.id } }) : Promise.resolve(0),
      ]);
      const allocatedQuantity = allocationsAgg._sum.allocatedQuantity ?? 0;
      const allocationsCount = allocationsAgg._count;
      // Readiness comes from the shared computation, not a local rule: the
      // placement step applies only to requiresAsset channel types, and
      // allocations and delivery are optional (a channel run in-house with no
      // partner and no delivery endpoint yet is still ready).
      const channelReadiness = await loadChannelReadiness(db, channel.id);
      const expected = expectedToDate(channel.contractedQuantity, channel.startDate, channel.endDate, now, timeZone);
      const pace = paceSignal(channel.deliveredCount, expected);
      return {
        channelId: channel.id,
        placementsCount,
        allocationsCount,
        allocatedQuantity,
        deliveryConfigured: deliveryConfigured > 0,
        ready: channelReadiness.ready,
        outstanding: channelReadiness.steps.filter((s) => s.required && !s.done).map((s) => s.title),
        requiredDone: channelReadiness.requiredDone,
        requiredTotal: channelReadiness.requiredTotal,
        hasPlacementStep: channelReadiness.steps.some((s) => s.id === "placement"),
        pace,
      };
    }),
  );
  const readinessByChannel = new Map(readiness.map((r) => [r.channelId, r]));
  const channelsReady = readiness.filter((r) => r.ready).length;
  const firstNotReady = campaign.channels.find((c) => readinessByChannel.get(c.id)?.ready === false);
  const notReadyCount = campaign.channels.length - channelsReady;

  const contracted = campaign.channels.reduce((sum, c) => sum + c.contractedQuantity, 0);
  const delivered = campaign.channels.reduce((sum, c) => sum + c.deliveredCount, 0);
  const allocatedTotal = readiness.reduce((sum, r) => sum + r.allocatedQuantity, 0);

  const paceBadgeVariant = (pace: "behind" | "onPace" | "ahead") =>
    pace === "behind" ? "destructive" : pace === "ahead" ? "default" : "secondary";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <Badge variant="outline">{campaign.code}</Badge>
        <Badge>{campaign.status}</Badge>
        {actor.isInternal && campaign.status !== "draft" && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/campaigns/${campaign.id}/leads`}>View leads</Link>
          </Button>
        )}
      </div>

      <ApprovalActions
        campaignId={campaign.id}
        status={campaign.status}
        canSubmit={hasPermission(actor, "campaign:submitInternal")}
        canApproveInternal={hasPermission(actor, "campaign:approveInternal")}
        canApproveClient={hasPermission(actor, "campaign:approveClient")}
      />

      {firstNotReady !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/40 p-4">
          <div>
            <div className="text-sm font-semibold">
              {notReadyCount === 1
                ? `Channel ${(firstNotReady.channelTypeVersion.definitionJson as { code?: string }).code} is not ready to go live`
                : `${notReadyCount} channels are not ready to go live`}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Outstanding:{" "}
              {(readinessByChannel.get(firstNotReady.id)?.outstanding ?? []).join(", ").toLowerCase()}
              {notReadyCount > 1 ? " (first channel)" : ""}. Optional steps — partner allocation and
              delivery configuration — do not block a channel.
            </div>
          </div>
          <Button asChild size="sm">
            <Link href={`/campaigns/${campaign.id}/channels/${firstNotReady.id}` as Route}>Finish channel setup</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {statCard("Contracted", String(contracted), `across ${campaign.channels.length} channel(s)`)}
        {statCard("Delivered", String(delivered), contracted > 0 ? `${Math.round((delivered / contracted) * 100)}% of contracted` : "—")}
        {statCard("Allocated to partners", String(allocatedTotal), `${Math.max(contracted - allocatedTotal, 0)} unallocated`)}
        {statCard("Channels ready", `${channelsReady} / ${campaign.channels.length}`, "setup complete")}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Channels</CardTitle>
          {canEditConfig && (
            <AddChannelDialog
              campaignId={campaign.id}
              campaignCurrency={campaign.currency}
              campaignStartDate={campaign.startDate.toISOString().slice(0, 10)}
              campaignEndDate={campaign.endDate.toISOString().slice(0, 10)}
              channelTypes={channelTypes}
            />
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Volume &amp; price</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Setup</TableHead>
                <TableHead>Pacing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.channels.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No channels yet.</TableCell>
                </TableRow>
              )}
              {campaign.channels.map((channel) => {
                const r = readinessByChannel.get(channel.id);
                const code = (channel.channelTypeVersion.definitionJson as { code?: string }).code;
                return (
                  <TableRow key={channel.id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}` as Route} className="block">
                        <div className="font-medium">{code}</div>
                        <div className="text-xs text-muted-foreground">v{channel.channelTypeVersion.version}</div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}` as Route} className="block">
                        {channel.contractedQuantity} leads · {channel.currency} {fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}` as Route} className="block">
                        {channel.startDate.toISOString().slice(0, 10)} – {channel.endDate.toISOString().slice(0, 10)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}` as Route} className="block">
                        <div className="flex flex-wrap gap-1">
                          {r?.ready === true ? (
                            <Badge>ready</Badge>
                          ) : (
                            (r?.outstanding ?? []).map((title) => (
                              <Badge key={title} variant="outline">{title}</Badge>
                            ))
                          )}
                        </div>
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          {r?.requiredDone ?? 0} of {r?.requiredTotal ?? 0} required steps done
                          {r?.allocationsCount === 0 ? " · in-house" : ""}
                          {r?.deliveryConfigured === false ? " · delivery unset" : ""}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}?tab=pacing` as Route} className="block">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-1.5 bg-foreground"
                            style={{ width: `${channel.contractedQuantity > 0 ? Math.min((channel.deliveredCount / channel.contractedQuantity) * 100, 100) : 0}%` }}
                          />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {channel.deliveredCount} / {channel.contractedQuantity} ·{" "}
                          <Badge variant={r !== undefined ? paceBadgeVariant(r.pace) : "secondary"} className="align-middle">
                            {r?.pace ?? "onPace"}
                          </Badge>
                        </div>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <IcpCriteriaEditor
          campaignId={campaign.id}
          initialCriteria={campaign.icpCriteria.map((c) => ({
            dimension: c.dimension,
            operator: c.operator,
            values: Array.isArray(c.valuesJson) ? c.valuesJson : [],
            isMandatory: c.isMandatory,
          }))}
          canEdit={canEditConfig}
        />
        <LeadFieldSpecEditor
          campaignId={campaign.id}
          initialFields={campaign.leadFieldSpecs.map((f) => ({
            fieldKey: f.fieldKey,
            label: f.label,
            dataType: f.dataType,
            isRequired: f.isRequired,
            rejectIfMissing: f.rejectIfMissing,
            allowedValues: Array.isArray(f.allowedValuesJson) ? f.allowedValuesJson : undefined,
            validationPattern: f.validationPattern ?? undefined,
          }))}
          canEdit={canEditConfig}
        />
      </div>
    </div>
  );
}
