-- AlterTable
--
-- DEP-4: this must be applyable while the previous application version is
-- still serving traffic, so the column carries a default rather than being
-- bare NOT NULL. Two things need it:
--   * existing rows, which get backfilled by the default;
--   * inserts from the old application version, which does not know the
--     column exists and would otherwise violate NOT NULL mid-roll.
-- `local:credential` is the value better-auth's own
-- `createLocalAccountIssuer("credential")` produces
-- (@better-auth/core/dist/db/schema/account.mjs), and credentials are the only
-- account provider this application enables, so it is the correct issuer for
-- every row that could predate this column. The default is deliberately kept
-- (not dropped at the end of this migration) for the same rolling-deploy
-- reason; prisma/schema.prisma declares it too, so the two stay in sync.
ALTER TABLE "authAccount" ADD COLUMN     "issuer" TEXT NOT NULL DEFAULT 'local:credential';

-- CreateIndex
CREATE INDEX "authAccount_issuer_accountId_idx" ON "authAccount"("issuer", "accountId");
