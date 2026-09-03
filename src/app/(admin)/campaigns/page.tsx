import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignTable } from "./campaign-table";

export default async function CampaignsPage() {
  const actor = await requireActor();
  assertPermission(actor, "campaign:read");

  // AUTH-9: a non-internal actor's list is filtered at the query, not the view.
  const campaigns = await db.campaign.findMany({
    where: {
      deletedAt: null,
      ...(actor.isInternal ? {} : { clientOrganizationId: actor.organizationId }),
    },
    include: { clientOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Serialise for the client component: Date and BigInt do not cross the boundary.
  const rows = campaigns.map((campaign) => ({
    id: campaign.id,
    code: campaign.code,
    name: campaign.name,
    clientName: campaign.clientOrganization.name,
    status: campaign.status,
    startDate: campaign.startDate.toISOString().slice(0, 10),
    endDate: campaign.endDate.toISOString().slice(0, 10),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
      </CardHeader>
      <CardContent>
        <CampaignTable rows={rows} />
      </CardContent>
    </Card>
  );
}
