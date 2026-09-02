import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  baseURL: process.env.APP_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // Better Auth's own credential/session tables are named to avoid a
  // Prisma model-name collision with this app's own `User` model (Task 6),
  // which is unrelated to Better Auth and must not be clobbered or renamed.
  // `User.authUserId` (Task 6) stores the id of the `AuthUser` row below.
  user: { modelName: "authUser" },
  account: { modelName: "authAccount" },
  verification: { modelName: "authVerification" },
  emailAndPassword: {
    enabled: true,
    // AUTH-1: there is no public registration. Users are created only by the
    // invitation acceptance path, which calls the server API directly.
    disableSignUp: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        body: `Reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        body: `Verify your email: ${url}`,
      });
    },
  },
  session: {
    modelName: "authSession",
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});
