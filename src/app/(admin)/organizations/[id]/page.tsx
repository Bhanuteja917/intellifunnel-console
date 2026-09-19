import Link from "next/link";
import { notFound } from "next/navigation";
import { Settings } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertOrganizationAccess, assertPermission, hasPermission } from "@/lib/auth/permissions";
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
import { EditUserDialog } from "../edit-user-dialog";
import { InvitationRowActions } from "../invitation-row-actions";
import { InviteUserDialog } from "../invite-user-dialog";
import { UserRowActions } from "../user-row-actions";

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  assertPermission(actor, "organization:read");
  assertOrganizationAccess(actor, id);

  const organization = await db.organization.findUnique({ where: { id } });
  if (organization === null || organization.deletedAt !== null) notFound();

  const canInvite = hasPermission(actor, "user:invite");
  const canManageUsers = hasPermission(actor, "user:manageRoles");
  const canEdit = hasPermission(actor, "organization:write");

  const [users, pendingInvitations, adminCount, roles] = await Promise.all([
    db.user.findMany({
      where: { organizationId: id, deletedAt: null },
      include: { roles: { include: { role: true } } },
      orderBy: { name: "asc" },
    }),
    canInvite
      ? db.invitation.findMany({
          where: { organizationId: id, status: "pending" },
          include: { role: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    db.user.count({
      where: {
        organizationId: id,
        deletedAt: null,
        roles: { some: { role: { code: { endsWith: "_ADMIN" } } } },
      },
    }),
    canInvite || canManageUsers
      ? db.role.findMany({ orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const allowedCodes = new Set<string>();
  if (organization.isClient) { allowedCodes.add("CLIENT_ADMIN"); allowedCodes.add("CLIENT_VIEWER"); }
  if (organization.isPartner) { allowedCodes.add("PARTNER_ADMIN"); allowedCodes.add("PARTNER_OPERATOR"); }
  if (organization.isInternal) { roles.forEach(r => allowedCodes.add(r.code)); }
  const filteredRoles = roles.filter(r => allowedCodes.has(r.code));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{organization.name}</h1>
        {organization.isClient && <Badge variant="outline">client</Badge>}
        {organization.isPartner && <Badge variant="outline">partner</Badge>}
        {organization.isInternal && <Badge variant="outline">internal</Badge>}
        <Badge>{organization.status}</Badge>
        {canEdit && (
          <Button variant="ghost" size="icon-sm" className="ml-auto" asChild>
            <Link href={`/organizations/${organization.id}/edit`} aria-label="Edit organisation">
              <Settings className="size-4" />
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Users</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{users.length}</CardContent>
        </Card>
        {canInvite && (
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Pending invitations</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{pendingInvitations.length}</CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Admins</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{adminCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>People · {users.length}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last active</TableHead>
                {canManageUsers && <TableHead className="w-24" />}
                {canManageUsers && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.roles.map((r) => r.role.name).join(", ")}</TableCell>
                  <TableCell><Badge>{user.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.lastLoginAt ? user.lastLoginAt.toISOString().slice(0, 10) : "—"}
                  </TableCell>
                  {canManageUsers && (
                    <TableCell>
                      <EditUserDialog
                        user={{
                          id: user.id,
                          name: user.name,
                          status: user.status,
                          roleCode: user.roles[0]?.role.code ?? "",
                        }}
                        roles={filteredRoles.map((role) => ({ code: role.code, name: role.name }))}
                      />
                    </TableCell>
                  )}
                  {canManageUsers && (
                    <TableCell>
                      <UserRowActions
                        userId={user.id}
                        userName={user.name}
                        canDelete={user.id !== actor.userId}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canInvite && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pending invitations · {pendingInvitations.length}</CardTitle>
            {organization.status !== "archived" ? (
              <InviteUserDialog
                organizationId={organization.id}
                organizationName={organization.name}
                roles={filteredRoles.map((role) => ({ code: role.code, name: role.name }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Invitations are disabled while this organisation is archived.</p>
            )}
          </CardHeader>
          <CardContent>
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invitations awaiting acceptance.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvitations.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
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
