import Link from "next/link";
import type { Route } from "next";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getLeadsForClient } from "@/lib/leads/client-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const DELIVERY_BADGE: Record<"pending" | "success" | "failed" | "notConfigured", "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  success: "default",
  failed: "destructive",
  notConfigured: "secondary",
};

const DELIVERY_LABEL: Record<"pending" | "success" | "failed" | "notConfigured", string> = {
  pending: "pending",
  success: "success",
  failed: "failed",
  notConfigured: "not configured",
};

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const actor = await requireActor();
  assertPortal(actor, "client");
  const { leads, nextCursor } = await getLeadsForClient(db, actor, { cursor });

  return (
    <Card>
      <CardHeader><CardTitle>Your leads</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Accepted</TableHead>
              <TableHead>Delivery</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No leads yet.
                </TableCell>
              </TableRow>
            )}
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>{lead.accountName}</TableCell>
                <TableCell>
                  {lead.contactName ?? lead.contactEmail}
                  <div className="text-xs text-muted-foreground">{lead.contactEmail}</div>
                </TableCell>
                <TableCell>{lead.campaignName}</TableCell>
                <TableCell>{lead.channelTypeName}</TableCell>
                <TableCell>{lead.acceptedAt.toISOString().slice(0, 10)}</TableCell>
                <TableCell>
                  <Badge variant={DELIVERY_BADGE[lead.deliveryStatus]}>{DELIVERY_LABEL[lead.deliveryStatus]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {nextCursor !== null && (
          <Link
            href={(`/client/leads?${new URLSearchParams({ cursor: nextCursor }).toString()}`) as Route}
            className="mt-4 block w-fit text-sm underline underline-offset-4"
          >
            Load more
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
