import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { NotFoundError } from "@/lib/errors";
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
import { SubmissionErrors } from "./submission-errors";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// LeadSubmission.status (ImportStatus): pending | processing | completed | failed
function submissionStatusVariant(status: string): BadgeVariant {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  return "outline"; // pending | processing
}

// Lead.verificationStatus (LeadVerificationStatus): pending | autoValidating | failed | needsReview | passed
function verificationStatusVariant(status: string): BadgeVariant {
  if (status === "passed") return "default";
  if (status === "failed") return "destructive";
  return "outline"; // needsReview | pending | autoValidating
}

export default async function CampaignLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [submissions, leads] = await Promise.all([
    db.leadSubmission.findMany({
      where: { campaignChannel: { campaignId: id } },
      include: { errors: { take: 10 } },
      orderBy: { submittedAt: "desc" },
    }),
    db.lead.findMany({
      where: { campaignChannel: { campaignId: id } },
      include: { account: true, contact: true, rejectReason: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const canUpload = hasPermission(actor, "campaign:write");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <Badge variant="outline">{campaign.code}</Badge>
        <span className="text-muted-foreground">Leads</span>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Submissions</CardTitle>
          {canUpload && (
            <Button asChild>
              <Link href={`/campaigns/${campaign.id}/leads/upload`}>Upload leads</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Rows (total / accepted / failed)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No submissions yet.
                  </TableCell>
                </TableRow>
              )}
              {submissions.map((submission) => (
                <TableRow key={submission.id}>
                  <TableCell>{submission.submittedAt.toISOString().slice(0, 19).replace("T", " ")}</TableCell>
                  <TableCell>{submission.sourceType}</TableCell>
                  <TableCell>
                    {submission.rowsTotal} / {submission.rowsAccepted} / {submission.rowsFailed}
                  </TableCell>
                  <TableCell>
                    <Badge variant={submissionStatusVariant(submission.status)}>{submission.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {submission.rowsFailed > 0 && (
                      <SubmissionErrors errors={submission.errors} rowsFailed={submission.rowsFailed} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Contact email</TableHead>
                <TableHead>Verification status</TableHead>
                <TableHead>Reject reason</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No leads yet.
                  </TableCell>
                </TableRow>
              )}
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>{lead.account.name}</TableCell>
                  <TableCell>{lead.contact.email}</TableCell>
                  <TableCell>
                    <Badge variant={verificationStatusVariant(lead.verificationStatus)}>
                      {lead.verificationStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{lead.rejectReason?.label ?? "—"}</TableCell>
                  <TableCell>{lead.createdAt.toISOString().slice(0, 10)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
