import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import { CURRENCY_EXPONENTS } from "@/lib/money/currency";
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
import { NewOrganizationDialog } from "./new-organization-dialog";
import { OrganizationTableRow } from "./organization-table-row";

export default async function OrganizationsPage() {
  const actor = await requireActor();
  assertPermission(actor, "organization:read");

  const organizations = await db.organization.findMany({
    where: {
      deletedAt: null,
      ...(actor.isInternal ? {} : { id: actor.organizationId }),
    },
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });

  const canCreateOrganization = hasPermission(actor, "organization:write");
  const canInvite = hasPermission(actor, "user:invite");

  const pendingCounts = canInvite
    ? new Map(
        (
          await db.invitation.groupBy({
            by: ["organizationId"],
            where: {
              status: "pending",
              organizationId: { in: organizations.map((organization) => organization.id) },
            },
            _count: { _all: true },
          })
        ).map((row) => [row.organizationId, row._count._all]),
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Organisations</CardTitle>
            <p className="text-sm text-muted-foreground">
              Open an organisation to manage its people and invitations.
            </p>
          </div>
          {canCreateOrganization && (
            <NewOrganizationDialog currencies={Object.keys(CURRENCY_EXPONENTS)} />
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Users</TableHead>
                {pendingCounts && <TableHead>Pending</TableHead>}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <OrganizationTableRow key={organization.id} organizationId={organization.id}>
                  <TableCell className="font-medium">{organization.name}</TableCell>
                  <TableCell className="flex gap-1">
                    {organization.isClient && <Badge variant="outline">client</Badge>}
                    {organization.isPartner && <Badge variant="outline">partner</Badge>}
                    {organization.isInternal && <Badge variant="outline">internal</Badge>}
                  </TableCell>
                  <TableCell>{organization._count.users}</TableCell>
                  {pendingCounts && (
                    <TableCell className="text-muted-foreground">
                      {pendingCounts.get(organization.id) ?? "—"}
                    </TableCell>
                  )}
                  <TableCell><Badge>{organization.status}</Badge></TableCell>
                </OrganizationTableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
