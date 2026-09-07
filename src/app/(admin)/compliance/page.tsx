import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { listDoNotContactEntries } from "@/lib/compliance/dnc";
import { getSetting } from "@/lib/settings/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddDncEntryDialog } from "./add-dnc-entry-dialog";
import { RetentionOverrideRow } from "./retention-override-row";
import { RemoveDncEntryButton } from "./remove-dnc-entry-button";
import { EraseContactForm } from "./erase-contact-form";

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ contactEmail?: string }>;
}) {
  const actor = await requireActor();
  assertPermission(actor, "compliance:read");

  const { contactEmail } = await searchParams;
  const normalizedSearch = contactEmail?.trim() ?? "";
  const contact = normalizedSearch === ""
    ? null
    : await db.contact.findFirst({
        where: { emailNormalized: normalizedSearch.toLowerCase() },
        select: { id: true, email: true, firstName: true, anonymisedAt: true },
      });

  const clientOrganizations = await db.organization.findMany({
    where: { deletedAt: null, isClient: true, status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, personalDataRetentionMonths: true },
  });

  const platformDefaultMonths = await getSetting(db, "personalDataRetentionMonths");

  const dncEntriesByOrg = await Promise.all(
    clientOrganizations.map((org) => listDoNotContactEntries(db, actor, org.id)),
  );
  const dncEntries = dncEntriesByOrg.flat();
  const orgNameById = new Map(clientOrganizations.map((o) => [o.id, o.name]));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Do-not-contact list</CardTitle>
          <AddDncEntryDialog clientOrganizations={clientOrganizations} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {dncEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{orgNameById.get(entry.clientOrganizationId) ?? entry.clientOrganizationId}</TableCell>
                  <TableCell>{entry.type}</TableCell>
                  <TableCell>{entry.value}</TableCell>
                  <TableCell>{entry.reason ?? "—"}</TableCell>
                  <TableCell>
                    <RemoveDncEntryButton id={entry.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal-data retention override</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Platform default</TableHead>
                <TableHead>Override (months)</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientOrganizations.map((org) => (
                <RetentionOverrideRow
                  key={org.id}
                  organizationId={org.id}
                  organizationName={org.name}
                  currentMonths={org.personalDataRetentionMonths}
                  platformDefaultMonths={platformDefaultMonths}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact erasure</CardTitle>
        </CardHeader>
        <CardContent>
          <EraseContactForm initialEmail={normalizedSearch} contact={contact} />
        </CardContent>
      </Card>
    </div>
  );
}
