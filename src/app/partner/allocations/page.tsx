import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { getAllocationsForPartner } from "@/lib/allocations/partner-view";
import { fromMinorUnits } from "@/lib/money/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export default async function PartnerAllocationsPage() {
  const actor = await requireActor();
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
              <TableHead>Quantity</TableHead>
              <TableHead>Payout rate</TableHead>
              <TableHead>Window</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No active allocations.
                </TableCell>
              </TableRow>
            )}
            {allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.channelTypeName}</TableCell>
                <TableCell>{a.funnelStageCode}</TableCell>
                <TableCell>{a.allocatedQuantity}</TableCell>
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
