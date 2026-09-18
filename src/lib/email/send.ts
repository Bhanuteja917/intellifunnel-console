import { Resend } from "resend";

export type EmailInput = { to: string; subject: string; body: string };

let client: Resend | null = null;

function getClient(): Resend {
  client ??= new Resend(process.env.RESEND_API_KEY);
  return client;
}

export async function sendEmail(input: EmailInput): Promise<void> {
  // Falsy, not just undefined: .env.example sets RESEND_API_KEY to an empty
  // string, so following it literally used to skip dev logging and call
  // Resend with an empty key.
  if (!process.env.RESEND_API_KEY) {
    console.info("[email:dev]", input.to, input.subject, input.body);
    return;
  }
  const result = await getClient().emails.send({
    from: process.env.EMAIL_FROM ?? "",
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
  if (result.error !== null) {
    throw new Error(`Email send failed: ${result.error.name} ${result.error.message}`);
  }
}
