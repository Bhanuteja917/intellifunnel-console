import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { listUnresolvedEntries } from "@/lib/identity/resolution-queue";
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
import { Alert, AlertTitle } from "@/components/ui/alert";
import { QueueRowActions } from "./queue-row-actions";

export default async function ResolutionQueuePage() {
  const actor = await requireActor();
  const { entries } = await listUnresolvedEntries(db, actor, { limit: 50 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account resolution queue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <Alert>
            <AlertTitle>Nothing awaiting a decision.</AlertTitle>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>List</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Candidates</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.listName}</TableCell>
                  <TableCell>{entry.rawName ?? "—"}</TableCell>
                  <TableCell>{entry.rawDomain ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={entry.matchStatus === "ambiguous" ? "destructive" : "outline"}>
                      {entry.matchStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.candidateAccountIds.length}</TableCell>
                  <TableCell>
                    <QueueRowActions entryId={entry.id} candidateAccountIds={entry.candidateAccountIds} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
