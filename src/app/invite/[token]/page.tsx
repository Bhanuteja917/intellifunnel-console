import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/invitations/invitations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } }, role: { select: { name: true } } },
  });

  if (invitation === null || invitation.status !== "pending") notFound();

  // This is an async Server Component executed once per request; `Date.now()`
  // here is a one-shot request-time read, not a value read across client re-renders.
  // eslint-disable-next-line react-hooks/purity
  const expired = invitation.expiresAt.getTime() <= Date.now();

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>Accept your invitation</CardTitle>
        </CardHeader>
        <CardContent>
          {expired ? (
            <Alert variant="destructive">
              <AlertTitle>This invitation has expired.</AlertTitle>
              <AlertDescription>Ask your administrator to resend it.</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                You have been invited to {invitation.organization.name} as {invitation.role.name}.
              </p>
              <AcceptForm token={token} email={invitation.email} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
