import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getAllocationsForPartner } from "@/lib/allocations/partner-view";
import { fromMinorUnits } from "@/lib/money/currency";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Every page under src/app/partner/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment for why the layout-level check alone is not enough.
export default async function PartnerAllocationsPage() {
  const actor = await requireActor();
  assertPortal(actor, "partner");
  const allocations = await getAllocationsForPartner(db, actor);

  return (
    <Card>
      <CardHeader><CardTitle>Your allocations</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel type</TableHead>
              <TableHead>Funnel stage</TableHead>
              {/*
                Capacity is enforced on reserved + delivered against the cap,
                so "delivered / cap" alone overstates what is still
                submittable — the reserved figure and the derived remaining
                figure are what actually predict the next rejection.
              */}
              <TableHead>Delivered / cap</TableHead>
              <TableHead>Reserved</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Pace</TableHead>
              <TableHead>Payout rate</TableHead>
              <TableHead>Window</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No active allocations.
                </TableCell>
              </TableRow>
            )}
            {allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.channelTypeName}</TableCell>
                <TableCell>{a.funnelStageCode}</TableCell>
                <TableCell>{a.deliveredCount} / {a.allocatedQuantity}</TableCell>
                <TableCell>{a.reservedCount}</TableCell>
                <TableCell>{Math.max(a.allocatedQuantity - a.deliveredCount - a.reservedCount, 0)}</TableCell>
                <TableCell>
                  <Badge variant={a.pace === "behind" ? "destructive" : a.pace === "ahead" ? "default" : "secondary"}>
                    {a.pace}
                  </Badge>
                </TableCell>
                <TableCell>
                  {a.payoutCurrency} {fromMinorUnits(a.payoutRateMinor, a.payoutCurrency)}
                </TableCell>
                <TableCell>
                  {a.startDate.toISOString().slice(0, 10)} – {a.endDate.toISOString().slice(0, 10)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
