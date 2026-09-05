import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
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
import { PlacementStatusControl } from "./placement-status-control";

export default async function PlacementsPage({
  params,
}: {
  params: Promise<{ id: string; channelId: string }>;
}) {
  const { id, channelId } = await params;
  const actor = await requireActor();
  assertPermission(actor, "asset:read");

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const channel = campaign.channels.find((c) => c.id === channelId);
  if (channel === undefined) notFound();

  const placements = await db.assetPlacement.findMany({
    where: { campaignChannelId: channelId },
    include: {
      asset: { select: { name: true } },
      assetVersion: { select: { version: true, fileName: true } },
      consentTextVersion: { select: { name: true, version: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const canWrite = hasPermission(actor, "asset:write");
  const channelLabel = (channel.channelTypeVersion.definitionJson as { name?: string; code?: string }).name
    ?? (channel.channelTypeVersion.definitionJson as { code?: string }).code;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/campaigns/${campaign.id}` as Route}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to campaign
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <Badge variant="outline">{campaign.code}</Badge>
          <span className="text-muted-foreground">Placements — {channelLabel}</span>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Placements</CardTitle>
          {canWrite && (
            <Button asChild size="sm">
              <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/placements/new` as Route}>
                New placement
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Landing page URL</TableHead>
                <TableHead>Form slug</TableHead>
                <TableHead>Consent text</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {placements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No placements yet.
                  </TableCell>
                </TableRow>
              )}
              {placements.map((placement) => (
                <TableRow key={placement.id}>
                  <TableCell>{placement.asset.name}</TableCell>
                  <TableCell>
                    v{placement.assetVersion.version} — {placement.assetVersion.fileName}
                  </TableCell>
                  <TableCell>
                    <a
                      href={placement.landingPageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      {placement.landingPageUrl}
                    </a>
                  </TableCell>
                  <TableCell>{placement.formSlug}</TableCell>
                  <TableCell>
                    {placement.consentTextVersion
                      ? `${placement.consentTextVersion.name} v${placement.consentTextVersion.version}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {canWrite ? (
                      <PlacementStatusControl
                        campaignId={campaign.id}
                        campaignChannelId={channel.id}
                        placementId={placement.id}
                        status={placement.status}
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
    </div>
  );
}
