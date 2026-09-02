export type EmailInput = { to: string; subject: string; body: string };

export async function sendEmail(input: EmailInput): Promise<void> {
  if (process.env.EMAIL_PROVIDER_API_KEY === undefined) {
    console.info("[email:dev]", input.to, input.subject, input.body);
    return;
  }
  const response = await fetch(`${process.env.EMAIL_PROVIDER_URL}/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.body,
    }),
  });
  if (!response.ok) {
    throw new Error(`Email send failed: ${response.status} ${await response.text()}`);
  }
}
