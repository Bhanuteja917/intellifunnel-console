import Link from "next/link";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
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

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "archived") return "secondary";
  return "outline";
}

export default async function AssetsPage() {
  const actor = await requireActor();
  assertPermission(actor, "asset:read");

  const assets = await db.asset.findMany({
    where: {
      ...(actor.isInternal ? {} : { ownerOrganizationId: actor.organizationId }),
    },
    include: { ownerOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const currentVersionIds = assets
    .map((asset) => asset.currentVersionId)
    .filter((id): id is string => id !== null);
  const currentVersions = currentVersionIds.length > 0
    ? await db.assetVersion.findMany({ where: { id: { in: currentVersionIds } } })
    : [];
  const currentVersionById = new Map(currentVersions.map((version) => [version.id, version]));

  const canCreate = hasPermission(actor, "asset:write");

  const rows = assets.map((asset) => {
    const currentVersion = asset.currentVersionId !== null
      ? currentVersionById.get(asset.currentVersionId)
      : undefined;
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      language: asset.language,
      ownerOrganizationName: asset.ownerOrganization.name,
      status: asset.status,
      currentFileName: currentVersion?.fileName ?? null,
      currentUploadedAt: currentVersion?.uploadedAt.toISOString().slice(0, 10) ?? null,
    };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Assets</CardTitle>
        {canCreate && (
          <Button asChild>
            <Link href="/assets/new">New asset</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Current version</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/assets/${row.id}`} className="underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                <TableCell>{row.language}</TableCell>
                <TableCell>{row.ownerOrganizationName}</TableCell>
                <TableCell>
                  {row.currentFileName !== null
                    ? `${row.currentFileName} (${row.currentUploadedAt})`
                    : "— no version uploaded —"}
                </TableCell>
                <TableCell><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
