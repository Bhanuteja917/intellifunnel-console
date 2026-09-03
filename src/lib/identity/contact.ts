import type { Contact, Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "@/lib/normalise/email";

type Db = PrismaClient | Prisma.TransactionClient;

export type ContactInput = {
  email: string;
  accountId: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  seniority?: string;
  jobFunction?: string;
  phone?: string;
  country?: string;
  linkedinUrl?: string;
};

/**
 * FR-ID-3: contacts are unique on normalised email across the platform, and a
 * contact appearing in a second campaign reuses the existing record. Undefined
 * fields are omitted from the update so a sparse submission cannot blank data
 * a richer one already supplied.
 */
export async function upsertContact(client: Db, input: ContactInput): Promise<Contact> {
  const emailNormalized = normalizeEmail(input.email);

  const updatable = {
    firstName: input.firstName,
    lastName: input.lastName,
    jobTitle: input.jobTitle,
    seniority: input.seniority,
    jobFunction: input.jobFunction,
    phone: input.phone,
    country: input.country,
    linkedinUrl: input.linkedinUrl,
  };
  const update = Object.fromEntries(
    Object.entries(updatable).filter(([, value]) => value !== undefined),
  ) as Prisma.ContactUpdateInput;

  return client.contact.upsert({
    where: { emailNormalized },
    update,
    create: {
      email: input.email.trim(),
      emailNormalized,
      accountId: input.accountId,
      ...updatable,
    },
  });
}
