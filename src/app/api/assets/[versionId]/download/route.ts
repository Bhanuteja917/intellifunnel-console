import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getStorageAdapter } from "@/lib/storage";
import { ApplicationError, NotFoundError } from "@/lib/errors";

// Must match the local adapter's own shortcut shape and default base dir
// (src/lib/storage/local-adapter.ts) byte-for-byte — this route is the
// "later task" that comment refers to.
const LOCAL_ADAPTER_PREFIX = "/api/assets/local/";
const LOCAL_BASE_DIR = ".data/asset-storage";

function statusForError(error: ApplicationError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 400;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  const { versionId } = await params;

  try {
    const actor = await requireActor();
    assertPermission(actor, "asset:read");

    const version = await db.assetVersion.findUnique({ where: { id: versionId } });
    if (version === null) throw new NotFoundError("Asset version not found");

    const storage = getStorageAdapter();
    const downloadUrl = await storage.getDownloadUrl(version.storageKey, 300);

    if (downloadUrl.startsWith(LOCAL_ADAPTER_PREFIX)) {
      // Local adapter's getDownloadUrl is a dev-only shortcut, not a real URL
      // a browser can fetch unauthenticated — take the key back out and read
      // the file ourselves instead of redirecting to it.
      const key = decodeURIComponent(downloadUrl.slice(LOCAL_ADAPTER_PREFIX.length));
      if (key.split(/[\\/]/).some((segment) => segment === "..")) {
        throw new NotFoundError("Asset version not found");
      }
      const filePath = path.join(LOCAL_BASE_DIR, key);
      const content = await readFile(filePath);
      return new Response(new Uint8Array(content), {
        status: 200,
        headers: {
          "Content-Type": version.mimeType,
          "Content-Length": String(content.byteLength),
          "Content-Disposition": `attachment; filename="${version.fileName.replace(/"/g, "")}"`,
        },
      });
    }

    // S3 adapter's case: a real, directly-fetchable presigned URL.
    return NextResponse.redirect(downloadUrl);
  } catch (error) {
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.message }, { status: statusForError(error) });
    }
    throw error;
  }
}
