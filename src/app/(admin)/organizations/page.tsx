import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
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
import { InviteUserDialog } from "./invite-user-dialog";
import { InvitationRowActions } from "./invitation-row-actions";

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

  const canInvite = hasPermission(actor, "user:invite");
  const roles = canInvite ? await db.role.findMany({ orderBy: { name: "asc" } }) : [];
  const pendingInvitations = canInvite
    ? await db.invitation.findMany({
        where: {
          status: "pending",
          organizationId: { in: organizations.map((organization) => organization.id) },
        },
        include: { organization: { select: { name: true } }, role: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Organisations</CardTitle>
          {canInvite && (
            <InviteUserDialog
              organizations={organizations.map((organization) => ({
                id: organization.id,
                name: organization.name,
              }))}
              roles={roles.map((role) => ({ code: role.code, name: role.name }))}
            />
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <TableRow key={organization.id}>
                  <TableCell>{organization.name}</TableCell>
                  <TableCell className="flex gap-1">
                    {organization.isClient && <Badge variant="outline">client</Badge>}
                    {organization.isPartner && <Badge variant="outline">partner</Badge>}
                    {organization.isInternal && <Badge variant="outline">internal</Badge>}
                  </TableCell>
                  <TableCell>{organization._count.users}</TableCell>
                  <TableCell><Badge>{organization.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invitations awaiting acceptance.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvitations.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
                      <TableCell>{invitation.organization.name}</TableCell>
                      <TableCell>{invitation.role.name}</TableCell>
                      <TableCell>{invitation.expiresAt.toISOString().slice(0, 10)}</TableCell>
                      <TableCell>
                        <InvitationRowActions invitationId={invitation.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
