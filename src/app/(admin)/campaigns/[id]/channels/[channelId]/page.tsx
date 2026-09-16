import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import type { Actor } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { getSetting } from "@/lib/settings/settings";
import { expectedToDate, expectedToDateWithSchedule, paceSignal } from "@/lib/allocations/pacing";
import { fromMinorUnits } from "@/lib/money/currency";
import { getDeliveryConfigForChannel } from "@/lib/delivery/config";
import { listDeliveryRunsForChannel } from "@/lib/delivery/runs";
import { availableSourceFields, type FieldMappingEntry } from "@/lib/delivery/field-mapping";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { loadChannelReadiness, type ChannelReadiness } from "@/lib/channels/readiness";
import { STEP_CATALOG } from "@/lib/channels/step-catalog";
import type { ChannelSetupStepKey } from "@prisma/client";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { getChannelApprovalStatus, getPlacementApprovalStatus } from "@/lib/approvals/status";
import { PlacementStatusControl } from "./placements/placement-status-control";
import { DeliveryConfigForm } from "./delivery/delivery-config-form";
import { RunLogTable } from "./delivery/run-log-table";
import { ChannelTermsTab, DecisionHistoryTab, TERMS_BADGE } from "./channel-terms-tab";
import { ChannelStatusControl } from "./channel-status-control";
import { SetupChecklistCard } from "./setup-checklist-card";
import { PacingScheduleCard } from "./pacing/pacing-schedule-card";
import { IcpCriteriaEditor } from "../../icp-criteria-editor";
import { LeadFieldSpecEditor } from "../../lead-field-spec-editor";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "terms", label: "Terms" },
  { id: "placements", label: "Placements" },
  { id: "allocations", label: "Allocations" },
  { id: "pacing", label: "Pacing" },
  { id: "delivery", label: "Delivery & runs" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function statCard(label: string, value: string, hint: string) {
  return (
    <Card key={label} className="flex-1 basis-40">
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; channelId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id, channelId } = await params;
  const { tab: rawTab } = await searchParams;
  const actor = await requireActor();

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const channel = campaign.channels.find((c) => c.id === channelId);
  if (channel === undefined) notFound();

  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : "overview";

  const canReadAssets = hasPermission(actor, "asset:read");
  const canWriteAssets = hasPermission(actor, "asset:write");
  const canReadAllocations = hasPermission(actor, "allocation:read");
  const canWriteAllocations = hasPermission(actor, "allocation:write");
  const canReadDelivery = hasPermission(actor, "delivery:read");
  const canWriteCampaign = hasPermission(actor, "campaign:write");

  const [placementsCount, activePlacementsCount, allocationsAgg, deliveryConfig] = await Promise.all([
    canReadAssets ? db.assetPlacement.count({ where: { campaignChannelId: channelId } }) : Promise.resolve(0),
    canReadAssets
      ? db.assetPlacement.count({ where: { campaignChannelId: channelId, status: "active" } })
      : Promise.resolve(0),
    canReadAllocations
      ? db.partnerAllocation.aggregate({
          where: { campaignChannelId: channelId },
          _sum: { allocatedQuantity: true },
          _count: true,
        })
      : Promise.resolve({ _sum: { allocatedQuantity: null }, _count: 0 }),
    canReadDelivery ? getDeliveryConfigForChannel(db, actor, channelId) : Promise.resolve(null),
  ]);
  const allocatedQuantity = allocationsAgg._sum.allocatedQuantity ?? 0;
  const allocationsCount = allocationsAgg._count;

  const channelDefinition = channel.channelTypeVersion.definitionJson as {
    name?: string;
    code?: string;
    requiresAsset?: boolean;
  };
  const channelLabel = channelDefinition.name ?? channelDefinition.code;

  // Every surface below reads the same readiness computation the activation
  // guard uses, so the badge, the checklist and what the server will allow can
  // never disagree.
  const readiness = await loadChannelReadiness(db, channelId);
  const termsStatus = await getChannelApprovalStatus(db, channel);
  const hasPlacementStep = readiness.steps.some((s) => s.key === "placement");
  const hasIcpStep = readiness.steps.some((s) => s.key === "icp");
  const hasLeadSpecStep = readiness.steps.some((s) => s.key === "leadSpec");
  const requiredSteps = readiness.steps.filter((s) => s.requirement === "required");
  const isReady = requiredSteps.every((s) => s.done);
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "placements") return hasPlacementStep;
    return true;
  });

  const definition = channel.channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition;
  const presentKeys = new Set(readiness.steps.map((s) => s.key));
  const addableSteps = STEP_CATALOG
    .filter((e) => e.available && e.applies(definition) && !presentKeys.has(e.key))
    .map((e) => ({ key: e.key as ChannelSetupStepKey, title: e.title }));

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/campaigns/${campaign.id}` as Route}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaign
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">Channel {channelLabel}</h1>
                <Badge variant="outline">{channelLabel}</Badge>
                <Badge variant={isReady ? "default" : "secondary"}>
                  {isReady ? "ready" : "setup incomplete"}
                </Badge>
                <Badge variant="outline">{channel.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {channel.contractedQuantity} leads · {channel.currency} {fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)} ·{" "}
                {channel.startDate.toISOString().slice(0, 10)} – {channel.endDate.toISOString().slice(0, 10)}
              </p>
            </div>
            {canWriteCampaign && (
              <div className="flex flex-none gap-2">
                <ChannelStatusControl
                  campaignId={campaign.id}
                  channelId={channel.id}
                  status={channel.status}
                />
              </div>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto border-t pt-1">
            {visibleTabs.map((t) => (
              <Link
                key={t.id}
                href={`/campaigns/${campaign.id}/channels/${channel.id}?tab=${t.id}` as Route}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                  tab === t.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.id === "placements" && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs">{placementsCount}</span>}
                {t.id === "allocations" && (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                    {allocatedQuantity} / {channel.contractedQuantity}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {tab === "overview" && (
        <OverviewTab
          campaignId={campaign.id}
          channel={channel}
          placementsCount={placementsCount}
          activePlacementsCount={activePlacementsCount}
          allocationsCount={allocationsCount}
          allocatedQuantity={allocatedQuantity}
          readiness={readiness}
          addableSteps={addableSteps}
          showPlacements={hasPlacementStep && canReadAssets}
          showAllocations={canReadAllocations}
          editable={channel.status === "draft" && canWriteCampaign}
        />
      )}

      {tab === "terms" && (
        <div className="flex flex-col gap-6">
          <ChannelTermsTab
            campaignId={campaign.id}
            channel={channel}
            channelLabel={channelLabel}
            termsStatus={termsStatus}
            canEdit={canWriteCampaign}
            blockedReason={
              campaign.status !== "draft"
                ? `Campaign is ${campaign.status} — terms are only editable while it is a draft`
                : channel.status !== "draft"
                  ? `Channel is ${channel.status} — terms are only editable while it is a draft`
                  : null
            }
          />
          {(hasIcpStep || hasLeadSpecStep) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {hasIcpStep && (
                <div className={hasLeadSpecStep ? undefined : "lg:col-span-2"}>
                  <IcpCriteriaEditor
                    channelId={channel.id}
                    initialCriteria={channel.icpCriteria.map((c) => ({
                      dimension: c.dimension,
                      operator: c.operator,
                      values: Array.isArray(c.valuesJson) ? c.valuesJson : [],
                      isMandatory: c.isMandatory,
                    }))}
                    canEdit={canWriteCampaign}
                  />
                </div>
              )}
              {hasLeadSpecStep && (
                <div className={hasIcpStep ? undefined : "lg:col-span-2"}>
                  <LeadFieldSpecEditor
                    channelId={channel.id}
                    initialFields={channel.leadFieldSpecs.map((f) => ({
                      fieldKey: f.fieldKey,
                      label: f.label,
                      dataType: f.dataType,
                      isRequired: f.isRequired,
                      rejectIfMissing: f.rejectIfMissing,
                      allowedValues: Array.isArray(f.allowedValuesJson) ? f.allowedValuesJson : undefined,
                      validationPattern: f.validationPattern ?? undefined,
                    }))}
                    canEdit={canWriteCampaign}
                  />
                </div>
              )}
            </div>
          )}
          <DecisionHistoryTab channelId={channel.id} />
        </div>
      )}

      {tab === "placements" && hasPlacementStep && canReadAssets && (
        <PlacementsTab campaignId={campaign.id} channelId={channel.id} canWrite={canWriteAssets} />
      )}

      {tab === "allocations" && canReadAllocations && (
        <AllocationsTab
          campaignId={campaign.id}
          channelId={channel.id}
          contractedQuantity={channel.contractedQuantity}
          canWrite={canWriteAllocations}
        />
      )}

      {tab === "pacing" && canReadAllocations && (
        <PacingTab campaignId={campaign.id} channelId={channel.id} channel={channel} canWriteCampaign={canWriteCampaign} />
      )}

      {tab === "delivery" && canReadDelivery && (
        <DeliveryTab
          actor={actor}
          campaignId={campaign.id}
          channelId={channel.id}
          leadFieldSpecs={channel.leadFieldSpecs.map((f) => f.fieldKey)}
          deliveryConfig={deliveryConfig}
        />
      )}
    </div>
  );
}

function OverviewTab({
  campaignId, channel, placementsCount, activePlacementsCount, allocationsCount, allocatedQuantity,
  readiness, addableSteps, showPlacements, showAllocations, editable,
}: {
  campaignId: string;
  channel: { id: string; contractedQuantity: number; deliveredCount: number; reservedCount: number };
  placementsCount: number;
  activePlacementsCount: number;
  allocationsCount: number;
  allocatedQuantity: number;
  readiness: ChannelReadiness;
  addableSteps: { key: ChannelSetupStepKey; title: string }[];
  showPlacements: boolean;
  showAllocations: boolean;
  editable: boolean;
}) {
  const requiredDone = readiness.requiredDoneCount;
  const requiredTotal = readiness.requiredTotalCount;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {statCard("Delivered", `${channel.deliveredCount} / ${channel.contractedQuantity}`, `${channel.reservedCount} reserved`)}
        {showPlacements && statCard("Placements live", String(activePlacementsCount), `${placementsCount} total`)}
        {showAllocations && statCard("Partner quota", `${allocatedQuantity} / ${channel.contractedQuantity}`, `${allocationsCount} allocation(s)`)}
        {statCard("Setup steps", `${requiredDone} / ${requiredTotal}`, "required steps complete")}
      </div>
      <SetupChecklistCard
        campaignId={campaignId}
        channelId={channel.id}
        steps={readiness.steps}
        requiredDoneCount={readiness.requiredDoneCount}
        requiredTotalCount={readiness.requiredTotalCount}
        addableSteps={addableSteps}
        editable={editable}
      />
    </div>
  );
}

async function PlacementsTab({ campaignId, channelId, canWrite }: { campaignId: string; channelId: string; canWrite: boolean }) {
  const placements = await db.assetPlacement.findMany({
    where: { campaignChannelId: channelId },
    include: {
      asset: { select: { name: true } },
      assetVersion: { select: { version: true, fileName: true } },
      consentTextVersion: { select: { name: true, version: true } },
      approvals: { orderBy: { decidedAt: "desc" }, take: 1, select: { comments: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // The client signs off on the live landing page URL before a placement can
  // collect leads; setPlacementStatus enforces it, and this column is what
  // tells the operator why "active" is unavailable.
  const approvalStatuses = new Map(
    await Promise.all(
      placements.map(
        async (placement) => [placement.id, await getPlacementApprovalStatus(db, placement)] as const,
      ),
    ),
  );

  const changesRequestedPlacements = placements.filter(
    (p) => approvalStatuses.get(p.id) === "changesRequested"
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Placements</CardTitle>
          <p className="text-sm text-muted-foreground">
            Where this channel&apos;s leads are collected: asset, landing page, form and consent text.
          </p>
        </div>
        {canWrite && (
          <Button asChild size="sm">
            <Link href={`/campaigns/${campaignId}/channels/${channelId}/placements/new` as Route}>New placement</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {changesRequestedPlacements.length > 0 && (
          <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex flex-col gap-2">
            <p className="text-sm font-semibold text-destructive">
              Client requested changes on {changesRequestedPlacements.length} placement(s)
            </p>
            {changesRequestedPlacements.map((p) => (
              <div key={p.id} className="text-sm text-muted-foreground">
                <span className="font-medium">{p.asset.name}:</span>{" "}
                {p.approvals[0]?.comments ?? "No comment provided"}
              </div>
            ))}
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Landing page URL</TableHead>
              <TableHead>Client approval</TableHead>
              <TableHead>Form slug</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {placements.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">No placements yet.</TableCell>
              </TableRow>
            )}
            {placements.map((placement) => (
              <TableRow key={placement.id}>
                <TableCell>{placement.asset.name} v{placement.assetVersion.version}</TableCell>
                <TableCell className="max-w-[200px] truncate">
                  <a href={placement.landingPageUrl} target="_blank" rel="noreferrer" title={placement.landingPageUrl} className="text-primary underline">
                    {placement.landingPageUrl}
                  </a>
                </TableCell>
                <TableCell>
                  {(() => {
                    const status = approvalStatuses.get(placement.id) ?? "pending";
                    const badge = TERMS_BADGE[status];
                    return (
                      <>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {placement.consentTextVersion && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {placement.consentTextVersion.name} v{placement.consentTextVersion.version}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </TableCell>
                <TableCell>{placement.formSlug}</TableCell>
                <TableCell>
                  {canWrite ? (
                    <PlacementStatusControl
                      campaignId={campaignId}
                      campaignChannelId={channelId}
                      placementId={placement.id}
                      status={placement.status}
                      approvalStatus={approvalStatuses.get(placement.id) ?? "pending"}
                    />
                  ) : (
                    <Badge>{placement.status}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function AllocationsTab({
  campaignId, channelId, contractedQuantity, canWrite,
}: {
  campaignId: string; channelId: string; contractedQuantity: number; canWrite: boolean;
}) {
  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: channelId },
    include: { partnerOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const allocated = allocations.reduce((sum, a) => sum + a.allocatedQuantity, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Partner allocations</CardTitle>
          <p className="text-sm text-muted-foreground">
            Split the {contractedQuantity}-lead channel quota across partners, with payout and identity rules.
          </p>
        </div>
        {canWrite && (
          <Button asChild size="sm">
            <Link href={`/campaigns/${campaignId}/channels/${channelId}/allocations/new` as Route}>New allocation</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-sm text-muted-foreground">
            <span>Quota allocated</span>
            <span className="tabular-nums">{allocated} of {contractedQuantity} · {Math.max(contractedQuantity - allocated, 0)} unallocated</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-2 bg-foreground"
              style={{ width: `${contractedQuantity > 0 ? Math.min((allocated / contractedQuantity) * 100, 100) : 0}%` }}
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partner</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Payout rate</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reveal client identity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No allocations yet — the whole quota is still unassigned.
                </TableCell>
              </TableRow>
            )}
            {allocations.map((allocation) => (
              <TableRow key={allocation.id}>
                <TableCell>
                  <Link
                    href={`/campaigns/${campaignId}/channels/${channelId}/allocations/${allocation.id}` as Route}
                    className="underline"
                  >
                    {allocation.partnerOrganization.name}
                  </Link>
                </TableCell>
                <TableCell>{allocation.allocatedQuantity}</TableCell>
                <TableCell>{allocation.payoutCurrency} {fromMinorUnits(allocation.payoutRateMinor, allocation.payoutCurrency)}</TableCell>
                <TableCell>{allocation.startDate.toISOString().slice(0, 10)} – {allocation.endDate.toISOString().slice(0, 10)}</TableCell>
                <TableCell><Badge>{allocation.status}</Badge></TableCell>
                <TableCell>{allocation.revealClientIdentity ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function PacingTab({
  campaignId, channelId, channel, canWriteCampaign,
}: {
  campaignId: string;
  channelId: string;
  channel: { contractedQuantity: number; startDate: Date; endDate: Date; deliveredCount: number; reservedCount: number };
  canWriteCampaign: boolean;
}) {
  const timeZone = await getSetting(db, "operatingTimezone");
  const now = new Date();

  const pacingBuckets = await db.channelPacingBucket.findMany({
    where: { campaignChannelId: channelId },
    orderBy: { periodStart: "asc" },
  });

  const channelExpected = pacingBuckets.length > 0
    ? expectedToDateWithSchedule(pacingBuckets, now, timeZone)
    : expectedToDate(channel.contractedQuantity, channel.startDate, channel.endDate, now, timeZone);

  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: channelId },
    include: { partnerOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const rejectionRows = await db.$queryRaw<{ partnerOrganizationId: string | null; rejected: bigint; total: bigint }[]>`
    SELECT ls."partnerOrganizationId",
           COUNT(*) FILTER (WHERE l."rejectReasonId" IS NOT NULL AND l."verificationStatus" = 'failed') AS rejected,
           COUNT(*) AS total
    FROM "Lead" l
    JOIN "LeadSubmission" ls ON ls.id = l."submissionId"
    WHERE l."campaignChannelId" = ${channelId}
    GROUP BY ls."partnerOrganizationId"
  `;
  const rejectionByPartner = new Map(
    rejectionRows
      .filter((r) => r.partnerOrganizationId !== null)
      .map((r) => [r.partnerOrganizationId as string, { rejected: Number(r.rejected), total: Number(r.total) }]),
  );

  const badgeVariant = (pace: "behind" | "onPace" | "ahead") =>
    pace === "behind" ? "destructive" : pace === "ahead" ? "default" : "secondary";

  return (
    <div className="flex flex-col gap-6">
      <PacingScheduleCard
        channelId={channelId}
        campaignId={campaignId}
        contractedQuantity={channel.contractedQuantity}
        startDate={channel.startDate}
        endDate={channel.endDate}
        deliveredCount={channel.deliveredCount}
        expectedToDate={channelExpected}
        initialBuckets={pacingBuckets}
        canWrite={canWriteCampaign}
        timeZone={timeZone}
      />

      <Card>
        <CardHeader><CardTitle>Per-partner pace &amp; rejection</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Delivered / cap</TableHead>
                <TableHead>Reserved</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Pace</TableHead>
                <TableHead>Rejection rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No allocations on this channel.{" "}
                    <Link href={`/campaigns/${campaignId}/channels/${channelId}?tab=allocations` as Route} className="underline">
                      Add one
                    </Link>
                  </TableCell>
                </TableRow>
              )}
              {allocations.map((a) => {
                const expected = expectedToDate(a.allocatedQuantity, a.startDate, a.endDate, now, timeZone);
                const pace = paceSignal(a.deliveredCount, expected);
                const rejection = rejectionByPartner.get(a.partnerOrganizationId);
                const rate = rejection === undefined || rejection.total === 0
                  ? "—"
                  : `${((rejection.rejected / rejection.total) * 100).toFixed(0)}%`;
                return (
                  <TableRow key={a.id}>
                    <TableCell>{a.partnerOrganization.name}</TableCell>
                    <TableCell>{a.deliveredCount} / {a.allocatedQuantity}</TableCell>
                    <TableCell>{a.reservedCount}</TableCell>
                    <TableCell>{Math.max(a.allocatedQuantity - a.deliveredCount - a.reservedCount, 0)}</TableCell>
                    <TableCell><Badge variant={badgeVariant(pace)}>{pace}</Badge></TableCell>
                    <TableCell>{rate}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

async function DeliveryTab({
  actor, campaignId, channelId, leadFieldSpecs, deliveryConfig,
}: {
  actor: Actor;
  campaignId: string;
  channelId: string;
  leadFieldSpecs: string[];
  deliveryConfig: Awaited<ReturnType<typeof getDeliveryConfigForChannel>>;
}) {
  const { runs } = await listDeliveryRunsForChannel(db, actor, channelId);
  const sourceFields = availableSourceFields(leadFieldSpecs);

  return (
    <div className="flex flex-col gap-6">
      <DeliveryConfigForm
        campaignId={campaignId}
        campaignChannelId={channelId}
        availableSourceFields={sourceFields}
        initial={
          deliveryConfig === null
            ? null
            : {
                method: deliveryConfig.method,
                status: deliveryConfig.status,
                webhookUrl: deliveryConfig.webhookUrl,
                csvScheduleCron: deliveryConfig.csvScheduleCron,
                fieldMapping: deliveryConfig.fieldMappingJson as unknown as FieldMappingEntry[],
              }
        }
      />
      <Card>
        <CardHeader><CardTitle>Delivery run log</CardTitle></CardHeader>
        <CardContent>
          <RunLogTable campaignId={campaignId} campaignChannelId={channelId} runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
