import Link from "next/link";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
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
import { listConsentTextVersions } from "@/lib/consent/crud";

export default async function ConsentTextsPage() {
  const actor = await requireActor();
  assertPermission(actor, "asset:read");

  const consentTexts = await listConsentTextVersions(db, actor);

  const canCreate = hasPermission(actor, "asset:write");

  const rows = consentTexts.map((text) => {
    // Truncate body to 150 characters for preview
    const bodyPreview = text.body.length > 150
      ? text.body.substring(0, 150) + "…"
      : text.body;

    return {
      id: text.id,
      name: text.name,
      version: text.version,
      language: text.language,
      effectiveFrom: text.effectiveFrom.toISOString().slice(0, 10),
      bodyPreview,
    };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Consent Texts</CardTitle>
        {canCreate && (
          <Button asChild>
            <Link href="/consent-texts/new">New consent text</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Effective From</TableHead>
              <TableHead>Body Preview</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.version}</TableCell>
                <TableCell>{row.language}</TableCell>
                <TableCell>{row.effectiveFrom}</TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                  {row.bodyPreview}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No consent texts yet. Create one to get started.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
