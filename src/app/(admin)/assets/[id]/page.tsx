import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { AssetStatusControl, UploadVersionForm } from "./upload-version-form";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  assertPermission(actor, "asset:read");

  const asset = await db.asset.findUnique({
    where: { id },
    include: { ownerOrganization: { select: { name: true } } },
  });
  if (asset === null) notFound();

  const versions = await db.assetVersion.findMany({
    where: { assetId: id },
    orderBy: { version: "desc" },
  });

  const canWrite = hasPermission(actor, "asset:write");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/assets" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to Assets
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{asset.name}</h1>
          <Badge variant="outline">{asset.type}</Badge>
          <Badge variant="outline">{asset.language}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-8 text-sm">
            <div>
              <div className="text-muted-foreground">Owner</div>
              <div>{asset.ownerOrganization.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Status</div>
              {canWrite ? (
                <AssetStatusControl assetId={asset.id} status={asset.status} />
              ) : (
                <Badge>{asset.status}</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Upload new version</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadVersionForm assetId={asset.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>File name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell>
                    v{version.version}
                    {version.id === asset.currentVersionId && (
                      <Badge className="ml-2" variant="default">current</Badge>
                    )}
                  </TableCell>
                  <TableCell>{version.fileName}</TableCell>
                  <TableCell>{formatBytes(version.sizeBytes)}</TableCell>
                  <TableCell>{version.uploadedAt.toISOString().slice(0, 10)}</TableCell>
                  <TableCell>
                    <a
                      href={`/api/assets/${version.id}/download`}
                      className="text-primary underline"
                    >
                      Download
                    </a>
                  </TableCell>
                </TableRow>
              ))}
              {versions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No versions uploaded yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
