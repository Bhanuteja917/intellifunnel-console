import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RetentionOverrideRow } from "./retention-override-row";
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

  const platformDefaultMonths = getSetting("personalDataRetentionMonths");

  return (
    <div className="flex flex-col gap-6">
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
