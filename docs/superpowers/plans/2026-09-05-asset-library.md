# Plan: PRD Epic E5 — Asset library and placements

**Spec:** `prd.md` §E5 (P0), `srs.md` §4.5 (Assets), §6.5 (FR-AP, partially deferred — see Global Constraints).

## Context

E5 is fully greenfield: none of `Asset`, `AssetVersion`, `AssetPlacement`, `ConsentTextVersion`, `EngagementEvent` exist in the schema, and no file/object-storage integration exists anywhere in this codebase (confirmed via research: no S3 client, no env vars, no `src/lib/storage/`). Every existing "file upload" in this app (TAL/suppression import, lead intake) reads the file client-side and passes raw text through — no durable binary storage, which is fine for CSVs but wrong for the PDFs/images this epic stores.

**Scope ruling, made with the user before this plan was written:** this platform does not host the public-facing gated-download experience. The actual "prospect fills out a form, downloads a whitepaper" flow lives on the client's own external landing-page infrastructure — not in this app. So `AssetPlacement.landingPageUrl`/`formSlug` are **reference fields only** (recording where the external gate lives, for reporting/audit), not routes this app serves. This plan builds **no public API route and no unauthenticated endpoint of any kind**. Concretely, this means:
- `POST /api/forms/:formSlug` (SRS §7.1) and `GET /api/assets/:token` (SRS §7.1) are **out of scope** — not deferred-with-a-plan, just not this system's job.
- `EngagementEvent` (views, form starts, completions) is **not created by this app** — nothing here produces that data, since the form-gate that would generate it runs elsewhere. The model is not added in this plan; there is no consumer for it yet, and adding an empty table with no writer would be dead schema.
- FR-AP (asset performance reporting) is **out of scope** — it's entirely derived from `EngagementEvent`, which this plan doesn't create. Revisit once an ingestion mechanism from the external landing-page system is defined (webhook, metric import, or otherwise) — that's a decision for whoever owns that integration, not this plan.
- `ConsentTextVersion` **is** included — it's simple, admin-managed versioned content (name/body/version/language/effective date), genuinely useful as a real dropdown value for `AssetPlacement.consentTextVersionId` regardless of where the form itself runs, and cheap to build alongside the rest of this plan's admin CRUD.

**What this plan does build:** the asset library itself (upload, versioning, ownership, type/language), placement management (associating an asset+version with a campaign channel, an external landing page URL, an external form slug, and a consent text version), the campaign-approval `requiresAsset` gate, and — because this is the first feature needing real file storage — a small storage abstraction with a safe local-disk dev fallback so nothing here depends on S3 credentials existing.

## Global Constraints

**Storage abstraction, not a direct S3 integration:** `src/lib/storage/` exposes one interface (`put`, `getDownloadUrl`, `delete`) with two implementations: a local-disk adapter (writes under a git-ignored `.data/asset-storage/` directory, used whenever `STORAGE_DRIVER` is unset or `"local"`) and an S3-compatible adapter (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — both new dependencies, add them) used when `STORAGE_DRIVER=s3` and the `S3_*` env vars are present. **No S3 credentials exist in this environment** — the S3 adapter is written and unit-testable via its own interface conformance, but this plan's own verification runs entirely against the local-disk adapter. Wiring real credentials in any environment is a deployment concern outside this plan.

**No public routes.** Every route this plan adds lives under `src/app/(admin)/`, gated the same way every other admin page is (`requireActor()` + `assertPermission`). Asset file downloads (for an admin user previewing/verifying an upload) go through one authenticated route handler (`src/app/api/assets/[versionId]/download/route.ts`) that calls `requireActor()`/`assertPermission` itself — this route is **not** added to `proxy.ts`'s matcher (API routes aren't covered by that matcher at all today; the handler does its own auth, same as every server action already does).

**Uploads go through a server action, not a new API route.** Next.js server actions accept `File`/`FormData` payloads directly — there's no need for a dedicated upload API endpoint. `uploadAssetVersionAction` takes a `FormData`, extracts the file, streams it to the storage adapter, and records the resulting metadata.

**Asset ownership:** `Asset.ownerOrganizationId` is the **client organization** the asset belongs to (assets are uploaded by internal ops on a client's behalf — there's no client portal yet, matching every other admin-side-only pattern in this app so far). The upload form's organization picker follows the exact same `clientOrganizations` query pattern already used by `campaigns/new/page.tsx`.

**Permissions:** two new `Permission` values, `"asset:read"` and `"asset:write"`, granted to `CAMPAIGN_MANAGER` and `OPERATIONS` (both already manage campaign-adjacent resources) — not to `QUALITY`/`FINANCE`/`ACCOUNT_MANAGER`. `SUPER_ADMIN` gets both via the existing bypass.

**`requiresAsset` gating placement:** `assertReadyForApproval` in `src/lib/campaigns/state-machine.ts` already checks "≥1 channel" and "≥1 ICP criterion" before `draft → pendingInternalApproval`, using data (`channelTypeVersion`) it already has loaded. This plan adds a third check to the *same* function: for every `CampaignChannel` whose `channelTypeVersion.definitionJson` (the frozen snapshot, not the live `ChannelType` — same convention E9 had to fix) has `requiresAsset: true`, at least one `AssetPlacement` with `status: "active"` must exist for that channel. This check runs **only** at the `draft → pendingInternalApproval` gate, matching where the two existing checks run — `decideClientApproval` (the second approval gate) does not currently re-run `assertReadyForApproval` at all (confirmed: neither existing check re-validates there either), so adding re-validation at the client-approval gate would be a change to established behavior beyond this plan's scope, not a gap this plan introduces.

**Verification convention** (same as every prior plan this session): `npx tsc --noEmit` + `npx eslint <files>` as primary gates; curl with a session cookie (`POST /api/auth/sign-in/email`, `bhanu@intellifunnel.io`/`TestPass123!`) for HTTP-reachable checks; throwaway `tsx` scripts (written, run, deleted, before/after state confirmed) against the shared dev DB for logic not reachable via HTTP. For file-upload-specific verification, a real small file (e.g. a throwaway `.txt` or `.pdf` under a few KB) written to a temp path and read back is fine — no need for exotic file types.

## Task 1: Storage abstraction

**Files:**
- Create: `src/lib/storage/types.ts`
- Create: `src/lib/storage/local-adapter.ts`
- Create: `src/lib/storage/s3-adapter.ts`
- Create: `src/lib/storage/index.ts`
- Modify: `package.json` (add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- Modify: `.env.example` (document the new, all-optional `STORAGE_DRIVER`/`S3_*` vars)

**Interfaces:**
```ts
// types.ts
export type StorageAdapter = {
  put(key: string, content: Buffer, contentType: string): Promise<void>;
  getDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
};
```

- [ ] **Step 1: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`**

- [ ] **Step 2: `local-adapter.ts`**

  `createLocalStorageAdapter(baseDir: string = ".data/asset-storage"): StorageAdapter`. `put` writes `Buffer` to `path.join(baseDir, key)` (create parent dirs with `fs.mkdir(..., {recursive:true})`). `getDownloadUrl` returns a `file://`-unusable-in-browser value in principle, but since this adapter only ever backs the authenticated admin download route (Task 1's own route, added in Task 3), it can simply return a relative app URL (`/api/assets/local/${encodeURIComponent(key)}`) that the download route itself resolves back to a file read — document this in a comment, it's a deliberate dev-only shortcut, not a general-purpose signed URL. `delete` removes the file, ignoring ENOENT (already-deleted is not an error). Add `.data/` to `.gitignore` if not already covered by an existing broad ignore pattern (check first).

- [ ] **Step 3: `s3-adapter.ts`**

  `createS3StorageAdapter(config: { endpoint?: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }): StorageAdapter`, using `S3Client`/`PutObjectCommand`/`DeleteObjectCommand`/`GetObjectCommand` + `getSignedUrl` from `@aws-sdk/s3-request-presigner` for `getDownloadUrl` (real presigned URL, `Expires: ttlSeconds`, matching the interface honestly — this is the adapter where `getDownloadUrl` means what it says). `endpoint` optional (unset = real AWS S3; set = R2/MinIO/any S3-compatible endpoint).

- [ ] **Step 4: `index.ts`**

  `getStorageAdapter(): StorageAdapter` — reads `process.env.STORAGE_DRIVER`; `"s3"` constructs the S3 adapter from `process.env.S3_*` (throw a clear `ValidationError`-style startup error if required vars are missing when this driver is explicitly selected — don't silently fall back); anything else (including unset) returns the local adapter. Memoize the instance (module-level singleton) rather than reconstructing per call.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Throwaway script: `getStorageAdapter()` with no env vars set returns a working local adapter — `put` a small buffer, confirm the file exists on disk with the right content, `getDownloadUrl` returns a string, `delete` removes it and a second `delete` doesn't throw. Do not attempt to test the S3 adapter against a real bucket (none exists) — a `tsc`-clean, structurally-correct implementation is this step's gate for that adapter, consistent with the Global Constraints.

- [ ] **Step 6: Commit**

---

## Task 2: Schema — Asset, AssetVersion, AssetPlacement, ConsentTextVersion, permissions

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/auth/permissions.ts`
- New migration

- [ ] **Step 1:**

  ```prisma
  enum AssetType {
    whitepaper
    ebook
    researchPaper
    creative
    webinar
    other
  }

  enum AssetStatus {
    draft
    active
    archived
  }

  enum AssetPlacementStatus {
    draft
    active
    paused
    archived
  }

  model Asset {
    id                  String      @id @default(cuid())
    ownerOrganizationId String
    name                String
    type                AssetType
    language            String
    currentVersionId    String?
    status              AssetStatus @default(draft)
    createdAt           DateTime    @default(now())
    updatedAt           DateTime    @updatedAt
    createdById         String?
    updatedById         String?

    ownerOrganization Organization      @relation(fields: [ownerOrganizationId], references: [id])
    versions          AssetVersion[]
    placements        AssetPlacement[]

    @@index([ownerOrganizationId])
  }

  model AssetVersion {
    id           String   @id @default(cuid())
    assetId      String
    version      Int
    storageKey   String
    fileName     String
    mimeType     String
    sizeBytes    Int
    uploadedById String?
    uploadedAt   DateTime @default(now())

    asset      Asset             @relation(fields: [assetId], references: [id])
    placements AssetPlacement[]

    @@unique([assetId, version])
  }

  model ConsentTextVersion {
    id            String   @id @default(cuid())
    name          String
    body          String
    version       Int
    language      String
    effectiveFrom DateTime @db.Date
    createdAt     DateTime @default(now())
    createdById   String?

    placements AssetPlacement[]
  }

  model AssetPlacement {
    id                   String                @id @default(cuid())
    campaignChannelId    String
    assetId              String
    assetVersionId       String
    landingPageUrl       String
    formSlug             String                @unique
    consentTextVersionId String?
    status               AssetPlacementStatus  @default(draft)
    createdAt            DateTime              @default(now())
    updatedAt            DateTime              @updatedAt
    createdById          String?
    updatedById           String?

    campaignChannel    CampaignChannel     @relation(fields: [campaignChannelId], references: [id])
    asset              Asset               @relation(fields: [assetId], references: [id])
    assetVersion        AssetVersion        @relation(fields: [assetVersionId], references: [id])
    consentTextVersion  ConsentTextVersion? @relation(fields: [consentTextVersionId], references: [id])

    @@index([campaignChannelId])
  }
  ```

  Add `assets AssetPlacement[]` back-relation to `CampaignChannel`, and `assets Asset[]` back-relation to `Organization`.

  Run `npx prisma migrate dev --name add_asset_library`. Purely additive.

- [ ] **Step 2:** In `src/lib/auth/permissions.ts`, add `"asset:read"`/`"asset:write"` to the `Permission` union; add both to `CAMPAIGN_MANAGER` and `OPERATIONS`'s arrays only.

- [ ] **Step 3: Verify**

  `npx tsc --noEmit`, `npx prisma validate`, confirm the migration applies and the new tables/columns exist (psql or a throwaway script). Confirm `hasPermission` for `CAMPAIGN_MANAGER`/`OPERATIONS` (`true`) vs. `QUALITY`/`FINANCE` (`false`).

- [ ] **Step 4: Commit**

---

## Task 3: Asset upload + versioning (admin UI + server actions)

**Files:**
- Create: `src/app/(admin)/assets/page.tsx`
- Create: `src/app/(admin)/assets/new/page.tsx`
- Create: `src/app/(admin)/assets/new/new-asset-form.tsx`
- Create: `src/app/(admin)/assets/[id]/page.tsx`
- Create: `src/app/(admin)/assets/[id]/upload-version-form.tsx`
- Create: `src/app/(admin)/assets/actions.ts`
- Create: `src/app/api/assets/[versionId]/download/route.ts`
- Create: `src/lib/assets/crud.ts`

**Interfaces:**
- `createAsset(db, actor, { ownerOrganizationId, name, type, language }): Promise<Asset>`
- `uploadAssetVersion(db, actor, storage, { assetId, file: {buffer, fileName, mimeType, sizeBytes} }): Promise<AssetVersion>` — creates the `AssetVersion` row, calls `storage.put`, and sets `Asset.currentVersionId` to the new version, all in one `$transaction` (the storage write itself can't be transactional with the DB, so: write to storage first, then the DB transaction — if the DB transaction fails after a successful storage write, the orphaned file is an acceptable, cheap-to-clean-up cost; the reverse order — DB row referencing a file that was never actually written — is the failure mode worth avoiding).

- [ ] **Step 1: Read for context**

  Read `campaigns/new/page.tsx`/`new-campaign-form.tsx` (org-picker + full-page-form pattern) and `campaigns/[id]/leads/upload/upload-form.tsx` (client-side file handling via `file.text()` — yours will use `file.arrayBuffer()` instead, since asset files are binary, then wrap in `Buffer.from(...)` server-side after the `FormData` roundtrip).

- [ ] **Step 2: `src/lib/assets/crud.ts`**

  `createAsset` — `assertPermission(actor, "asset:write")`, plain `db.asset.create`. `uploadAssetVersion` — `assertPermission(actor, "asset:write")`, compute `version = (last version for this asset ?? 0) + 1`, call `storage.put(key, buffer, mimeType)` where `key` is something collision-proof like `assets/${assetId}/${version}-${fileName}`, then `db.$transaction` creating the `AssetVersion` row and updating `Asset.currentVersionId`.

- [ ] **Step 3: `assets/page.tsx`** — list page. `requireActor()`, `assertPermission(actor, "asset:read")`. Table: name, type badge, language, owner org name, current version's `fileName`/`uploadedAt`, status badge. "New asset" button (gated `asset:write`) linking to `./new`.

- [ ] **Step 4: `assets/new/page.tsx` + `new-asset-form.tsx`** — full-page form (org picker exactly like `campaigns/new`, name, type select, language input), calls `createAssetAction`, then immediately redirects to `/assets/${asset.id}` so the user can upload the first version right away.

- [ ] **Step 5: `assets/[id]/page.tsx` + `upload-version-form.tsx`** — shows the asset's metadata (including its current `status`) and a version history table (version, fileName, sizeBytes formatted, uploadedAt, a "Download" link to `/api/assets/${version.id}/download`), plus `<UploadVersionForm>`: a native `<input type="file">`, `useTransition`+toast on submit via a server action that builds `FormData`, reads the file with `file.arrayBuffer()`, and calls `uploadAssetVersionAction`. Also render a small status-change control (a `Select` of `draft`/`active`/`archived` calling `setAssetStatusAction` on change) — **this is required, not optional**: an asset created via Task 3, Step 4 defaults to `status: "draft"`, and Task 5's placement picker only offers `active` assets, so without a way to flip this here, no asset built by this task could ever be placed. Any-to-any transition, no state-machine complexity (mirrors `AssetPlacementStatus`'s own unrestricted transitions in Task 5).

- [ ] **Step 6: `assets/actions.ts`** — `createAssetAction`, `uploadAssetVersionAction(formData: FormData)` (extracts `assetId`/the `File` from `formData`, converts to `Buffer`, calls `uploadAssetVersion(db, actor, getStorageAdapter(), {...})`), `setAssetStatusAction(assetId: string, status: "draft" | "active" | "archived")` (`assertPermission(actor, "asset:write")`, plain `db.asset.update`).

- [ ] **Step 7: `src/app/api/assets/[versionId]/download/route.ts`** — `export async function GET(req, { params })`: `requireActor()`, `assertPermission(actor, "asset:read")`, fetch the `AssetVersion`, call `storage.getDownloadUrl(version.storageKey, 300)`, redirect (`NextResponse.redirect`) to it. For the local adapter's dev-shortcut URL shape (Task 1, Step 2), this route additionally needs to handle serving the raw file bytes directly when the resolved "URL" is actually its own local-serving path — read Task 1's local adapter comment for the exact shape and implement whichever side of that contract this route owns.

- [ ] **Step 8: Verify**

  `npx tsc --noEmit` clean. Curl: sign in, `POST` a real small file through the upload flow isn't practical via curl against a server action (same limitation every prior plan's file-upload tasks hit) — verify the upload path via a throwaway script calling `uploadAssetVersion` directly with an in-memory buffer, confirming the file lands in `.data/asset-storage/` with correct content, the `AssetVersion` row is correct, and `Asset.currentVersionId` updates. Curl-check `GET /assets` and `GET /assets/new` both 200. Curl-check the download route returns the file's bytes/a redirect for a version created by the throwaway script.

- [ ] **Step 9: Commit**

---

## Task 4: Consent text version management

**Files:**
- Create: `src/app/(admin)/consent-texts/page.tsx`
- Create: `src/app/(admin)/consent-texts/new/page.tsx`
- Create: `src/app/(admin)/consent-texts/new/new-consent-text-form.tsx`
- Create: `src/app/(admin)/consent-texts/actions.ts`
- Create: `src/lib/consent/crud.ts`

**Interfaces:** `createConsentTextVersion(db, actor, { name, body, language, effectiveFrom }): Promise<ConsentTextVersion>` — `version` auto-computed as `(max version for this name ?? 0) + 1`, so each `name` is its own versioned series (e.g. "EU GDPR consent", "Default US consent" each accumulate their own version numbers).

- [ ] **Step 1: `src/lib/consent/crud.ts`** — `createConsentTextVersion`, `assertPermission(actor, "asset:write")` (reuse this epic's permission — consent text is a small adjunct to placements, not worth a dedicated permission). `listConsentTextVersions(db, actor)` — `assertPermission(actor, "asset:read")`.

- [ ] **Step 2: `consent-texts/page.tsx`** — simple list: name, version, language, effectiveFrom, a truncated body preview. "New" button.

- [ ] **Step 3: `consent-texts/new/page.tsx` + form** — name, a `<textarea>` for body, language, effective-date picker. Full-page form, same conventions as `assets/new`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean, curl-check both pages 200, throwaway script confirms version auto-increment per distinct `name`.

- [ ] **Step 5: Commit**

---

## Task 5: Placement management

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/new/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/new/new-placement-form.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/actions.ts`
- Create: `src/lib/assets/placements.ts`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx` (one link added to each channel row/card — read the existing Channels card first, add a "Placements" link per channel, matching its existing per-channel action style)

**Interfaces:** `createAssetPlacement(db, actor, { campaignChannelId, assetId, assetVersionId, landingPageUrl, formSlug, consentTextVersionId }): Promise<AssetPlacement>`. `setPlacementStatus(db, actor, { placementId, status }): Promise<AssetPlacement>`.

- [ ] **Step 1: Read for context** — read the existing Channels card in `campaigns/[id]/page.tsx`. Note: this table currently has NO action column at all (`TableHead`s are just "Channel type"/"Quantity"/"Unit price"/"Window", no per-row actions) — there is no existing action style to match. Add one new `TableHead` (e.g. "Placements" or leave it unlabeled/icon-only, your call) and one new `TableCell` per row containing a `Link` to `./channels/${channel.id}/placements`, styled as a plain text link or small `Button variant="outline" size="sm"`, consistent with this app's other list-row links (e.g. the leads list page's per-row links). Don't touch the ICP/lead-field-spec cards on this page — same rule every prior plan touching this file has followed.

- [ ] **Step 2: `src/lib/assets/placements.ts`** — `createAssetPlacement`: `assertPermission(actor, "asset:write")`, validate `assetVersionId` actually belongs to `assetId` (throw `ValidationError` if not — a placement pinned to the wrong asset's version would silently serve the wrong file later), `db.assetPlacement.create`. `setPlacementStatus`: `assertPermission(actor, "asset:write")`, plain update — no state-machine complexity needed, `AssetPlacementStatus` transitions are unrestricted (draft/active/paused/archived, any→any) since the PRD doesn't specify a constrained flow here, only that "active" is what the campaign-approval gate and (eventually) the partner portal both key off.

- [ ] **Step 3: `placements/page.tsx`** — list placements for one campaign channel: asset name, version's fileName, landingPageUrl, formSlug, consent text version's name+version, status badge with an inline status-change action (a small `Select` calling `setPlacementStatusAction`, no separate page for this). "New placement" link.

- [ ] **Step 4: `placements/new/page.tsx` + form** — asset picker (only assets belonging to the campaign's `clientOrganizationId`, i.e. filter `db.asset.findMany({where:{ownerOrganizationId: campaign.clientOrganizationId, status:"active"}})` — an asset must itself be `active` to be placed, matching how a `draft` campaign channel or `draft` asset shouldn't be placeable yet), then once an asset is picked, a version picker scoped to that asset's versions (client-side cascading select, or a full page reload with `?assetId=` — pick whichever is simpler given this app's established patterns; a full reload via a `<select>` inside a `<form>` with `GET` method, mirroring the upload page's channel-filter pattern from the E9 plan, is simplest), landingPageUrl input, formSlug input (with a note that it must be globally unique — surface the `@@unique` constraint violation as a friendly `ValidationError`, not a raw Prisma error, same convention as everywhere else in this app), consent-text-version picker (optional).

- [ ] **Step 5: `placements/actions.ts`** — `createAssetPlacementAction`, `setPlacementStatusAction`.

- [ ] **Step 6: Wire the campaign detail page link** — one `Link` per channel row/card to `./channels/${channel.id}/placements`.

- [ ] **Step 7: Verify** — `npx tsc --noEmit` clean. Curl-check the placements list/new pages 200 for a fixture campaign channel. Throwaway script: create a placement with an `assetVersionId` that belongs to a DIFFERENT asset than the supplied `assetId` — confirm it's rejected; create a valid one — confirm it's queryable; attempt a second placement with the same `formSlug` — confirm the unique constraint surfaces as a friendly error via the action, not a raw 500.

- [ ] **Step 8: Commit**

---

## Task 6: Campaign-approval `requiresAsset` gate

**Files:**
- Modify: `src/lib/campaigns/state-machine.ts`

**Interfaces:** no new exported function — one new check added inside the existing `assertReadyForApproval`.

- [ ] **Step 1: Read for context** — read `assertReadyForApproval` in full (the "≥1 channel" and "≥1 ICP criterion" checks) to match its exact style: same function, same `ValidationError` throwing convention, same data already loaded (`channels` with `channelTypeVersion` included).

- [ ] **Step 2: Add the check** — for each channel in the already-fetched `channels` array, read `(channel.channelTypeVersion.definitionJson as ChannelTypeDefinition).requiresAsset` (the frozen snapshot — not `channel.channelTypeVersion.channelType.requiresAsset`, the live row; same convention E9's final fix wave established for `requiresTeleVerification`/`verificationSlaBusinessDays`, for the identical reason: a later edit to the channel type must not retroactively change an in-flight campaign's approval requirements). For every such channel, `db.assetPlacement.count({where:{campaignChannelId: channel.id, status:"active"}})` must be `> 0` — if not, throw `ValidationError` naming the specific channel (e.g. by its `channelTypeVersion`'s definitionJson `code`/`name`, matching how the existing checks phrase their messages) so the operator knows exactly which channel is missing a placement, not just "some channel somewhere."

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean. Throwaway script: a campaign with a `requiresAsset:true` channel and no active placement — `submitForInternalApproval` throws, naming the right channel; add an active placement — the same call now succeeds; a campaign with only `requiresAsset:false` channels — unaffected regardless of placements. Confirm the existing "≥1 channel"/"≥1 ICP criterion" checks still fire correctly and weren't disturbed (test a campaign missing those instead, confirm the right error surfaces first, matching whatever check-ordering already exists in the function).

- [ ] **Step 4: Commit**
