# Software Requirements Specification
## B2B Demand Generation Campaign & Lead Fulfilment Platform

**Version:** 0.2 (draft for review)
**Date:** 2 September 2026
**Companion document:** PRD-demand-generation-platform.md
**Changes in 0.2:** multi-currency with INR reporting currency, manual exchange rate table, configurable payout triggers with acceptance-date period boundary and Finance-role approval, per-account lead caps, per-client do-not-contact scope, external call reference in place of stored recordings, 3-business-day verification SLA with working calendar, 12-month personal data retention with anonymisation

---

## 1. Scope

This document specifies the software behaviour, data model, interfaces and constraints for the platform described in the PRD. It covers the admin, client and partner portals, the lead intake and verification pipeline, and the delivery integrations.

---

## 2. Technology stack

| Layer | Technology | Notes |
|---|---|---|
| Application | Next.js (App Router) | Server components for data-heavy views, server actions for mutations, route handlers for public and machine-facing endpoints |
| Language | TypeScript, strict mode | |
| Database | Neon (serverless Postgres) | Branching used for preview environments |
| ORM and migrations | Prisma | Migrations checked into version control, applied at deploy |
| Authentication | Better Auth | Email/password plus invitation flow, session management, email verification, password reset |
| Authorisation | Application-layer RBAC | Organisation-scoped roles resolved per request |
| File storage | S3-compatible object storage | Assets, uploads, call recordings, delivery payloads |
| Background work | Queue-backed job runner | Intake processing, delivery runs, metric imports, scheduled reports |
| Deployment | Docker | Multi-stage build, container per environment |
| Email | Transactional email provider | Invitations, notifications, scheduled reports |

### 2.1 Architectural notes

- The Next.js application is deployed as a standalone Node server inside a container, not on a serverless-only host, because background processing and long-running import jobs are required.
- Prisma connects to Neon through a pooled connection string. Migrations run against the direct connection.
- The job runner runs in a separate container from the web server, sharing the same codebase and database.
- Neon branching provides an isolated database per preview deployment.

---

## 3. Authentication and authorisation

### 3.1 Access model

**AUTH-1.** There is no public registration. All accounts originate from an invitation.

**AUTH-2.** Internal users are invited by a Super Admin. Client and partner users are invited by an internal user or by an existing admin of their own organisation.

**AUTH-3.** An invitation record holds: target email, target organisation, intended role, token hash, expiry, inviting user, status. Tokens are single-use and expire after a configurable period (default 7 days).

**AUTH-4.** Accepting an invitation creates the user, binds it to the organisation with the intended role, and marks the email verified. The email on the invitation cannot be changed at acceptance.

**AUTH-5.** Invitations can be resent (new token, old token invalidated) and revoked.

**AUTH-6.** A user belongs to exactly one organisation. A person needing access to two organisations requires two accounts with distinct email addresses.

**AUTH-7.** Session handling, credential storage, password reset and email verification are delegated to Better Auth. Roles and organisation binding live in application tables joined to the Better Auth user record.

### 3.2 Role definitions

| Portal | Role | Key permissions |
|---|---|---|
| Admin | Super Admin | All. User, role and channel type administration |
| Admin | Campaign Manager | Campaign CRUD, approvals, pacing, reporting |
| Admin | Operations | Allocation, intake, verification, replacements |
| Admin | Quality | Verification decisions, reject reasons, consent audit |
| Admin | Account Manager | Client records, orders, reporting |
| Admin | Finance | Read access to commercial views. Exchange rate maintenance. Sole authority to approve and close payout periods |
| Client | Client Admin | Campaign approval, list and asset upload, delivery config, user invitation |
| Client | Client Viewer | Read-only |
| Partner | Partner Admin | Allocation visibility, submissions, user invitation |
| Partner | Partner Operator | Submissions, spec visibility, rejection feedback |

### 3.3 Authorisation enforcement

**AUTH-8.** Every data access path resolves the acting user's organisation and role before returning data. Authorisation is enforced server-side in the data access layer, not in the UI.

**AUTH-9.** Client-scoped queries are filtered by organisation at the query level. A client can never construct a request that returns another organisation's data.

**AUTH-10.** Partner-facing responses are assembled from a restricted projection that omits client identity, client pricing, other allocations and internal notes. This is a distinct read model, not field filtering applied to the admin response.

**AUTH-11.** Client-facing responses omit partner identity, payout rates, margin, rejected leads and internal verification notes.

---

## 4. Data model

Entity names below map to Prisma models. Fields listed are the significant ones, not exhaustive; every table carries `id`, `createdAt`, `updatedAt` and, where mutable by users, `createdById` and `updatedById`.

### 4.1 Organisations and users

**Organization** — `name`, `legalName`, `isClient`, `isPartner`, `isInternal`, `status`, `country`, `defaultBillingCurrency`, `defaultPayoutCurrency`, `payoutTrigger` (monthlyArrears | campaignClose), `notes`

**OrganizationDomain** — `organizationId`, `domain` (normalised, unique)

**User** — `email` (unique, normalised), `name`, `organizationId`, `status`, `lastLoginAt`. Linked one-to-one with the Better Auth user record.

**Role** — `code`, `name`, `portal` (admin | client | partner)

**UserRole** — `userId`, `roleId`

**Invitation** — `email`, `organizationId`, `roleId`, `tokenHash`, `expiresAt`, `invitedById`, `status`, `acceptedAt`, `revokedAt`

**AuditLog** — `actorUserId`, `actorOrganizationId`, `entityType`, `entityId`, `action`, `beforeJson`, `afterJson`, `occurredAt`, `ipAddress`

### 4.2 Identity resolution

**Account** — canonical company. `name`, `normalizedName`, `primaryDomain` (normalised), `parentAccountId`, `country`, `industry`, `employeeRange`, `revenueRange`, `enrichmentSource`, `enrichedAt`

**AccountAlias** — `accountId`, `value`, `type` (name | domain), unique on normalised value

**Contact** — `accountId`, `email`, `emailNormalized` (unique), `firstName`, `lastName`, `jobTitle`, `seniority`, `jobFunction`, `phone`, `country`, `linkedinUrl`

**DoNotContact** — `type` (email | domain | phone), `value` (normalised), `clientOrganizationId` (required), `reason`, `addedAt`, `expiresAt`

Do-not-contact entries belong to a client organisation and apply across that client's campaigns only. There is no agency-wide list and no cross-client suppression. The table is created in phase 1; enforcement in the intake pipeline lands in phase 5 (see §10). Unique on (`clientOrganizationId`, `type`, `value`).

**Domain normalisation rule:** lowercase, strip protocol, strip `www.`, strip trailing dot, take registrable domain. Applied consistently at write time and stored, never computed at query time.

### 4.3 Campaign configuration

**Campaign** — `clientOrganizationId`, `name`, `code` (unique), `status`, `startDate`, `endDate`, `currency`, `defaultMaxLeadsPerAccount` (nullable, null means uncapped), `clonedFromCampaignId`, `approvedSnapshotId`

**CampaignApproval** — `campaignId`, `type` (internal | client), `decision` (approved | rejected), `decidedByUserId`, `decidedAt`, `comments`, `configSnapshotJson`, `snapshotVersion`

**IcpCriterion** — `campaignId`, `dimension` (industry | employeeRange | revenueRange | country | region | jobFunction | seniority | jobTitle | custom), `operator` (in | notIn | between | contains), `valuesJson`, `isMandatory`

**LeadFieldSpec** — `campaignId`, `fieldKey`, `label`, `isRequired`, `dataType`, `allowedValuesJson`, `validationPattern`, `rejectIfMissing`

**TargetAccountList** — `ownerOrganizationId`, `name`, `isReusable`

**TargetAccountEntry** — `listId`, `rawName`, `rawDomain`, `accountId` (nullable until matched), `matchStatus` (matched | unmatched | ambiguous), `maxLeadsPerAccountOverride` (nullable)

Cap resolution: the entry override wins if set, otherwise the campaign default applies, otherwise the account is uncapped. Caps count accepted leads only, and are evaluated per campaign, not per campaign channel, unless the campaign is configured otherwise.

**CampaignTargetAccountList** — `campaignId`, `listId`

**SuppressionList** — `ownerOrganizationId`, `name`, `isReusable`, `type` (client | competitor | existingCustomer | prior | custom)

**SuppressionEntry** — `listId`, `type` (account | domain | email | contact), `value` (normalised), `accountId`, `contactId`

**CampaignSuppressionList** — `campaignId`, `listId`

### 4.4 Channels and programs

**FunnelStage** — `code` (PROGRAMMATIC | TOFU | MOFU | BOFU), `name`, `sortOrder`

**ChannelType** — `code`, `name`, `funnelStageId`, `producesLeads`, `requiresAsset`, `metricMode` (event | aggregate), `allowedMetricFieldsJson`, `pricingUnit` (CPL | CPM | CPA | flat), `defaultQualificationFormId`, `verificationRuleSetId`, `requiresTeleVerification`, `verificationSlaBusinessDays` (nullable), `isActive`, `currentVersion`

`verificationSlaBusinessDays` is nullable. When unset, the platform default of 3 business days applies. Super Admin can change the platform default and can override it per channel type. Elapsed business time is recorded for every lead regardless of the configured value.

**Holiday** — `date`, `name`, `country`, `isActive`. Non-working days excluded from SLA calculation alongside the configured weekly working days.

**ChannelTypeVersion** — `channelTypeId`, `version`, `definitionJson` (frozen full definition), `publishedAt`, `publishedById`

**CampaignChannel** — `campaignId`, `channelTypeVersionId`, `contractedQuantity`, `clientUnitPrice`, `costBudget`, `currency`, `startDate`, `endDate`, `status`, `qualificationFormId`

**QualificationForm** — `name`, `version`, `isActive`

**QualificationQuestion** — `formId`, `sortOrder`, `text`, `type` (single | multi | text | boolean | date), `optionsJson`, `isRequired`, `isQualifying`, `acceptableAnswersJson`

**QualificationAnswer** — `leadId`, `questionId`, `valueJson`, `answeredAt`

Rationale: `isQualifying` marks questions whose answers determine acceptance. A lead answering outside `acceptableAnswersJson` on a qualifying question fails validation automatically.

### 4.5 Assets

**Asset** — `ownerOrganizationId`, `name`, `type` (whitepaper | ebook | researchPaper | creative | webinar | other), `language`, `currentVersionId`, `status`

**AssetVersion** — `assetId`, `version`, `fileKey`, `fileName`, `mimeType`, `sizeBytes`, `uploadedById`, `uploadedAt`

**AssetPlacement** — `campaignChannelId`, `assetId`, `assetVersionId`, `landingPageUrl`, `formSlug` (unique), `consentTextVersionId`, `status`

Constraint: a campaign channel whose channel type has `requiresAsset = true` must have at least one active placement before the campaign can be approved.

### 4.6 Allocation

**PartnerAllocation** — `campaignChannelId`, `partnerOrganizationId`, `allocatedQuantity`, `payoutRate`, `payoutCurrency`, `startDate`, `endDate`, `status`, `revealClientIdentity` (default false)

The payout currency is inherited from the partner organisation's default and overridable per allocation. It is independent of the campaign's billing currency.

**AllocationCounter** — `allocationId`, `submitted`, `accepted`, `rejected`, `replacementsOwed`, `updatedAt`. Maintained transactionally.

**CampaignChannelCounter** — `campaignChannelId`, `accepted`, `delivered`, `expectedToDate`, `updatedAt`

### 4.7 Leads

**EngagementEvent** — `assetPlacementId`, `contactId`, `occurredAt`, `ipAddress`, `userAgent`, `sourceUrl`, `referrer`, `formPayloadJson`, `consentTextVersionId`, `consentTimestamp`

**ConsentTextVersion** — `body`, `version`, `language`, `effectiveFrom`

**LeadSubmission** — `campaignChannelId`, `allocationId`, `sourceType` (internal | partner | form), `submittedByUserId`, `fileKey`, `mappingJson`, `rowsTotal`, `rowsAccepted`, `rowsFailed`, `status`, `submittedAt`

**Lead** — `campaignChannelId`, `allocationId`, `submissionId`, `engagementEventId`, `contactId`, `accountId`, `sourceType`, `verificationStatus`, `lifecycleStatus`, `enrichmentStatus`, `clientVisible`, `acceptedAt`, `rejectedAt`, `rejectReasonId`, `replacementForLeadId`, `deliveredAt`, `verificationElapsedMinutes`, `verificationElapsedBusinessMinutes`, `slaBreached`, `anonymisedAt`, `legalHold`, `fieldValuesJson`

**LeadFieldValue** — optional normalised alternative to `fieldValuesJson` where per-field querying is needed: `leadId`, `fieldKey`, `value`

**RejectReason** — `code`, `label`, `category` (dataQuality | icpMismatch | suppression | duplicate | consent | qualification | contactability), `isPartnerReplaceable`, `isActive`

**VerificationRecord** — `leadId`, `method` (auto | manual | tele), `ruleResultsJson`, `outcome` (pass | fail | needsReview), `verifiedByUserId`, `callSystem`, `callReferenceId`, `callOccurredAt`, `callDurationSeconds`, `callRecordingKey` (reserved, unused in v1), `notes`, `occurredAt`

The platform does not store call audio. `callSystem` and `callReferenceId` identify the recording in the external telephony system. `callRecordingKey` is reserved so platform-side storage can be enabled later without a schema change or a data migration.

**LeadStatusHistory** — `leadId`, `dimension` (verification | lifecycle | enrichment), `fromValue`, `toValue`, `changedByUserId`, `changedAt`, `reason`

**EnrichmentTask** — `leadId`, `assignedToUserId`, `status`, `dueAt`, `completedAt`, `notes`

**Appointment** — `leadId`, `scheduledAt`, `timezone`, `durationMinutes`, `attendeesJson`, `status`, `outcome`, `notes`

### 4.8 Metrics

**ChannelMetricDaily** — `campaignChannelId`, `date`, `impressions`, `clicks`, `spend`, `currency`, `sourceSystem`, `importBatchId`. Unique on (`campaignChannelId`, `date`, `sourceSystem`).

**MetricImportBatch** — `sourceSystem`, `fileKey`, `periodStart`, `periodEnd`, `rowsTotal`, `rowsAccepted`, `rowsFailed`, `importedById`, `status`

Event-level metrics are derived from `EngagementEvent` and `Lead`, not stored redundantly.

### 4.9 Commercials

**Order** — `campaignId`, `clientOrganizationId`, `currency`, `status`, `signedAt`, `poNumber`

**OrderLine** — `orderId`, `campaignChannelId`, `quantity`, `unitPrice`, `lineValue`

**PartnerPayout** — `allocationId`, `partnerOrganizationId`, `trigger` (monthlyArrears | campaignClose), `periodStart`, `periodEnd`, `acceptedQuantity`, `rate`, `amount`, `currency`, `reportingAmount`, `exchangeRateId`, `status`

**ChannelCostActual** — `campaignChannelId`, `costType` (partner | media | other), `amount`, `currency`, `reportingAmount`, `exchangeRateId`, `incurredOn`, `reference`

**ExchangeRate** — `fromCurrency`, `toCurrency`, `rate`, `effectiveDate`, `source` (manual | feed), `enteredById`. Unique on (`fromCurrency`, `toCurrency`, `effectiveDate`).

**PlatformSetting** — `key`, `valueJson`, `updatedById`, `updatedAt`. Editable by Super Admin only, with audit entries. Required keys at launch:

| Key | Launch value | Notes |
|---|---|---|
| `reportingCurrency` | `INR` | Single currency for internal margin and cross-client reporting |
| `defaultVerificationSlaBusinessDays` | `3` | Applies where a channel type does not override it |
| `operatingTimezone` | `Asia/Kolkata` | Boundary for payout periods, pacing days and SLA clocks |
| `workingDays` | `MO,TU,WE,TH,FR` | Days the SLA clock advances |
| `workingHours` | `09:00–18:00` | Used only if hour-level SLA precision is enabled; day-level is the default |
| `personalDataRetentionMonths` | `12` | Consent artifacts and personal data |
| `invitationExpiryDays` | `7` | |

#### Currency handling

**CUR-1.** Every monetary field stores an explicit currency alongside the amount. There is no implicit default.

**CUR-2.** Three currencies are independent: the client billing currency (on the order), the partner payout currency (on the allocation), and the agency reporting currency, which is INR.

**CUR-3.** Amounts are converted to INR at the time the transaction is recorded, using the rate effective on that date. The converted amount and the rate used are both persisted. Historical reports do not move when rates change.

**CUR-4.** Rates are maintained manually in the `ExchangeRate` table in v1, entered by Finance or Super Admin. An external rate feed writes to the same table later; `source` distinguishes the two. No application code should read rates from anywhere else.

**CUR-5.** A missing rate for a required conversion is a hard error at the point of recording, not a silent fallback to 1.0. The UI surfaces missing currency pairs as a Finance task before they block a transaction.

**CUR-6.** Amounts are stored as integer minor units with the currency's exponent, never as floating point.

**CUR-7.** A rate is looked up as the most recent entry with `effectiveDate` on or before the transaction date. Rates are never interpolated.

### 4.10 Delivery

**DeliveryProfile** — `clientOrganizationId`, `campaignId` (nullable, campaign-specific override), `method` (webhook | sftp | crm | csvEmail), `endpointRef`, `credentialsRef`, `fieldMappingJson`, `schedule` (realtime | hourly | daily | weekly), `formatOptionsJson`, `isActive`

**DeliveryRun** — `profileId`, `periodStart`, `periodEnd`, `leadCount`, `status`, `payloadKey`, `attemptCount`, `lastError`, `completedAt`

**DeliveryItem** — `runId`, `leadId`, `status`, `error`

### 4.11 Imports

**ImportBatch** — `type` (targetAccounts | suppression | leads | metrics), `uploadedById`, `organizationId`, `fileKey`, `mappingJson`, `rowsTotal`, `rowsAccepted`, `rowsFailed`, `status`

**ImportError** — `batchId`, `rowNumber`, `field`, `rawValue`, `message`

### 4.12 Notifications

**Notification** — `userId`, `type`, `payloadJson`, `readAt`, `sentChannels`

**NotificationPreference** — `userId`, `type`, `inApp`, `email`

---

## 5. State machines

### 5.1 Campaign

```
Draft
  → Pending Internal Approval
      → Draft (rejected, with comments)
      → Pending Client Approval
          → Draft (rejected, with comments)
          → Scheduled (approved; config snapshot written)
              → Live (flight start date reached)
                  → Paused (manual)
                      → Live
                  → Completed (flight end or quota fulfilled)
  → Cancelled (from any pre-Live state)
```

**FR-CS-1.** Transition to Scheduled writes an immutable configuration snapshot and freezes the channel type versions in use.

**FR-CS-2.** Configuration changes to a Live campaign require a re-approval cycle for any field in the snapshot set (ICP, lead field spec, quantities, prices, dates, qualification questions). Non-snapshot fields (internal notes, allocations) do not.

**FR-CS-3.** A campaign auto-completes when every campaign channel reaches its contracted quantity, or when the flight end date passes, whichever is first.

### 5.2 Lead verification status

```
Pending → AutoValidating → { Failed | NeedsReview | Passed }
NeedsReview → { Passed | Failed }  (manual decision)
```

### 5.3 Lead lifecycle status

```
New → Accepted → Delivered
New → Rejected
```

Accepted and Delivered are separate because delivery is asynchronous and can fail. Rejected is terminal; there is no client-side rejection after delivery.

### 5.4 Lead enrichment status

```
NotRequired | Pending → InProgress → Complete
```

Enrichment status is independent of verification. A lead may be `NeedsReview` on verification and `Pending` on enrichment simultaneously.

---

## 6. Functional requirements

### 6.1 Lead intake

**FR-IN-1.** All leads enter a staging state. No lead is client-visible before verification passes.

**FR-IN-2.** File upload supports CSV and XLSX with an interactive column mapping step. Mappings are saved per allocation for reuse.

**FR-IN-3.** Validation runs per row and returns a downloadable error report identifying row number, field and reason. Partial success is permitted: valid rows proceed, invalid rows are reported.

**FR-IN-4.** Automated validation executes in this order, short-circuiting on first failure:
1. Required field spec (per campaign)
2. Format validation (email syntax, phone format, allowed values)
3. Do-not-contact check against the client organisation's list (phase 5; no-op until then)
4. Suppression check (account, domain, email, contact)
5. Duplicate check within campaign
6. Duplicate check across the client's other live campaigns
7. Target account list match, where the campaign requires it
8. Per-account cap check: accepted leads for the resolved account against the entry override or campaign default
9. ICP criteria match on available fields
10. Qualifying question answers against acceptable values
11. Consent completeness, where the channel type requires it

**FR-IN-5.** Each failed check produces a `RejectReason` from the controlled vocabulary. Free-text reasons are not permitted.

**FR-IN-6.** Intake enforces the allocation cap. Submissions exceeding the remaining cap are rejected at the row level with a distinct reason code.

**FR-IN-7.** Checks 7 and 9 may be configured as advisory (route to `NeedsReview`) rather than blocking, per campaign.

**FR-IN-8.** The per-account cap in check 8 counts accepted leads only, so a lead pending verification does not consume cap. Where two submissions for the same account are in flight simultaneously, the cap is re-evaluated at acceptance time inside the acceptance transaction. Exceeding it at that point produces a distinct reject reason and does not consume allocation quota.

### 6.2 Verification

**FR-VF-1.** Leads with outcome `NeedsReview` enter a work queue with assignment, filtering by campaign, partner and age.

**FR-VF-2.** Channel types with `requiresTeleVerification` require a `VerificationRecord` with method `tele` and a populated `callSystem` and `callReferenceId` before acceptance. The platform validates that the reference is present, not that the call exists.

**FR-VF-2a.** The verification SLA is 3 business days by default, configurable platform-wide by Super Admin and overridable per channel type.

**FR-VF-2b.** SLA elapsed time is computed in business days, excluding configured non-working weekdays and dates in the `Holiday` table, evaluated in the operating timezone. A lead arriving Friday evening is not in breach on Monday morning.

**FR-VF-2c.** Both raw elapsed time and business-day elapsed time are stored on the lead. Raw time is what operations reporting needs; business-day time is what the SLA is measured against. Storing only one of them makes the other unrecoverable.

**FR-VF-2d.** Leads at 75% of their SLA are highlighted in the queue. Leads past it are flagged and counted in breach reporting by channel type, partner and assignee.

**FR-VF-2e.** Changing the working calendar or holiday table affects future SLA calculations only. Breach status already recorded is not recomputed.

**FR-VF-3.** Acceptance is transactional: it writes the accepted timestamp, increments the campaign channel and allocation counters, and sets `clientVisible` in one transaction.

**FR-VF-4.** Rejection records a reason code and notifies the submitting partner. If the reason is `isPartnerReplaceable`, the allocation's `replacementsOwed` counter increments.

**FR-VF-5.** A replacement lead references the rejected lead via `replacementForLeadId` and decrements `replacementsOwed` on acceptance.

### 6.3 Quota and pacing

**FR-QP-1.** Counters are maintained transactionally with the status change that causes them, never recomputed by a background aggregation.

**FR-QP-2.** `expectedToDate` is computed linearly across the flight window unless a custom pacing curve is configured.

**FR-QP-3.** Pacing status is derived: on pace, behind, ahead, at risk. "At risk" fires when projected completion exceeds the flight end date.

**FR-QP-4.** Acceptance beyond the contracted quantity is blocked by default, with an admin override that records who overrode and why.

### 6.4 Delivery

**FR-DL-1.** A campaign cannot go Live without an active delivery profile resolved for it, unless the client is portal-only by explicit configuration.

**FR-DL-2.** Field mapping is validated against the campaign's lead field spec at profile save time, not at delivery time.

**FR-DL-3.** Delivery runs retry with exponential backoff up to a configured limit, then raise an alert to the account manager and operations.

**FR-DL-4.** Delivery payloads are archived for the retention period to support dispute resolution.

**FR-DL-5.** A lead is marked `Delivered` only on confirmed delivery. Delivery failure does not reverse acceptance or the quota count.

### 6.5 Asset performance

**FR-AP-1.** Asset performance is derived from `EngagementEvent` joined to `AssetPlacement` and `Lead`. There is no separate download-tracking table.

**FR-AP-2.** Reported per placement: views, form starts, completions, leads accepted, acceptance rate. Reported per asset across campaigns: total downloads, campaigns used, aggregate acceptance rate.

**FR-AP-3.** Clients see engagement event detail for their own campaigns, including who downloaded and when, for accepted leads. Engagement events tied to rejected leads are excluded from client views.

**FR-AP-4.** Channels with `requiresAsset = false` report only their aggregate metric fields and are excluded from asset reporting.

### 6.6 Commercials and payouts

**FR-CM-1.** Partner payout trigger is configured on the partner organisation and defaults onto its allocations. Two modes are supported: monthly in arrears, and on campaign close.

**FR-CM-2.** For monthly-arrears partners, a payout period is generated per calendar month covering all allocations active in that month. Leads fall into a period by their **acceptance date**, not their delivery date, evaluated in the operating timezone. A lead accepted on 31 March and delivered on 1 April belongs to the March payout.

**FR-CM-2a.** Once a monthly payout period is approved it is closed. A late correction affecting a closed period is issued as an adjustment on the next open period, never by reopening the closed one.

**FR-CM-3.** For campaign-close partners, a single payout period is generated per allocation when the parent campaign reaches Completed.

**FR-CM-4.** A partner with allocations under both modes across different campaigns is supported. The trigger is resolved per allocation, not per partner globally.

**FR-CM-5.** Payout amounts are computed from accepted quantity multiplied by the allocation payout rate, in the allocation's payout currency, with a reporting-currency equivalent persisted alongside.

**FR-CM-6.** A payout period is approved by a single user holding the Finance role. There is no second approver and no value threshold requiring escalation. The approving user and timestamp are recorded on the payout record and in the audit log.

**FR-CM-6a.** Payout records are immutable once approved. Corrections are issued as adjustment records against the next open period, not as edits.

**FR-CM-7.** Client billable amounts are computed from accepted quantity per campaign channel against the order line unit price, in the order currency.

### 6.7 Channel type administration

**FR-CT-1.** Creating or editing a channel type is a configuration action available to Super Admin, with no code deployment.

**FR-CT-2.** Publishing a change creates a new `ChannelTypeVersion`. Existing campaigns retain their bound version.

**FR-CT-3.** `allowedMetricFieldsJson` constrains which metric fields the UI presents and which the import accepts for that channel.

**FR-CT-4.** A channel type cannot be deleted once referenced by any campaign; it is deactivated instead.

### 6.8 Identity resolution

**FR-ID-1.** Accounts are matched on normalised primary domain first, then on normalised name plus country, then on alias.

**FR-ID-2.** Ambiguous matches are flagged rather than guessed, and appear in an admin resolution queue.

**FR-ID-3.** Contacts are unique on normalised email across the platform. A contact appearing in a second campaign reuses the existing record.

**FR-ID-4.** Account merge reassigns all child records and writes an audit entry. Merges are reversible within a configurable window.

### 6.9 Compliance

**FR-CP-1.** Every lead from an asset-gated channel must carry a linked `EngagementEvent` with consent text version, timestamp, IP and source URL. Absence is a blocking validation failure.

**FR-CP-2.** Consent text is versioned. The version in force at capture time is recorded, not a pointer to the current text.

**FR-CP-3.** An erasure request anonymises the `Contact` and clears personal fields on associated leads while preserving lead identifiers, counters and aggregate metrics.

**FR-CP-4.** Personal data and consent artifacts are retained for 12 months by default, configurable platform-wide by Super Admin and overridable per client organisation where a client's jurisdiction demands a different period. The clock runs from lead acceptance.

**FR-CP-4a.** Expiry anonymises rather than deletes. The following are removed: name, email, phone, IP address, form payload, job title, LinkedIn URL, call reference. The following survive indefinitely: lead identifier, campaign channel, allocation, account, accepted and delivered timestamps, reject reason, all counters and all financial records. Delivery volumes and payout history must remain reconstructible after personal data has gone.

**FR-CP-4b.** Retention runs as a scheduled job with a dry-run mode and an audit entry per affected record. Records under an active legal hold flag are skipped.

**FR-CP-4c.** Call audio is out of scope: the platform holds only an external reference, and retention of the audio itself is the telephony system's responsibility.

**FR-CP-5.** Do-not-contact lists are per client organisation. A suppression entry for one client has no effect on another client's campaigns.

**FR-CP-6.** Suppression and do-not-contact entries are exempt from retention expiry. Suppressing a person requires keeping an identifier for them, so those values are stored as salted hashes that survive anonymisation of the contact record.

---

## 7. Interfaces

### 7.1 Public endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/forms/:formSlug` | Asset gate form submission; creates `EngagementEvent`, `Contact` and `Lead` |
| `GET /api/assets/:token` | Time-limited asset download after form completion |
| `GET /invite/:token` | Invitation acceptance |

### 7.2 Partner-facing

Partner interactions are performed through the portal UI. A partner submission API is a P1 addition, authenticated by per-allocation API key, accepting the same validation pipeline as file upload.

### 7.3 Client-facing delivery

Outbound only. Webhook POST with the client's mapped payload, SFTP file drop, or CRM push. No inbound client API in v1.

### 7.4 Metric import

Aggregate metrics are imported by file upload in v1. Direct DSP connectors are P2.

---

## 8. Non-functional requirements

### 8.1 Performance

**NFR-P-1.** Lead list views return within 2 seconds at 500,000 leads per client organisation, using indexed, paginated, cursor-based queries.

**NFR-P-2.** File imports up to 50,000 rows process asynchronously with progress reporting; the user is not blocked.

**NFR-P-3.** Validation of a single lead completes within 500 ms excluding manual steps.

### 8.2 Security

**NFR-S-1.** All authorisation decisions are made server-side. Client-side role checks are presentational only.

**NFR-S-2.** Delivery credentials and API keys are encrypted at rest and never returned to any client, including admins.

**NFR-S-3.** Object storage access is via time-limited signed URLs. No public buckets.

**NFR-S-4.** Rate limiting on public form endpoints, invitation acceptance and authentication routes.

**NFR-S-5.** Personal data fields are encrypted at rest at the database level.

### 8.3 Auditability

**NFR-A-1.** Every mutation to campaign configuration, allocation, lead status, counters, pricing and user roles writes an audit entry with actor, timestamp and before/after state.

**NFR-A-2.** Audit entries are append-only and not editable through any application path.

### 8.4 Data integrity

**NFR-D-1.** Counter updates and the status changes that drive them occur in the same database transaction.

**NFR-D-2.** Unique constraints enforce: normalised contact email, normalised account domain, campaign code, form slug, and one metric row per channel/date/source.

**NFR-D-3.** Soft deletion is used for entities referenced by leads or financial records. Hard deletion is reserved for erasure requests.

### 8.5 Availability and operations

**NFR-O-1.** Target availability 99.5% for the portals.

**NFR-O-2.** Structured logging with correlation IDs across web and worker containers.

**NFR-O-3.** Health endpoints for container orchestration.

**NFR-O-4.** Database backups with point-in-time recovery, retention 30 days.

---

## 9. Deployment

**DEP-1.** Multi-stage Dockerfile: dependency install, build, and a slim runtime image running the Next.js standalone output.

**DEP-2.** Separate worker image, or the same image with a different entrypoint, running the job processor.

**DEP-3.** Environments: local, preview (per branch, using Neon database branching), staging, production.

**DEP-4.** Migrations run as a discrete step before the new application version accepts traffic. Migrations must be backwards-compatible with the previous application version to allow rolling deploys.

**DEP-5.** Configuration is entirely environment-variable driven. No environment-specific code paths.

**DEP-6.** Seed data required in every environment: funnel stages, base channel types, reject reason vocabulary, role definitions.

---

## 10. Phasing

| Phase | Contents |
|---|---|
| 1 | Organisations, invitations, RBAC, identity resolution, campaign configuration, channel type admin, approval workflow |
| 2 | Assets and placements, form capture, engagement events, consent |
| 3 | Allocation, lead intake, validation pipeline, verification queue, reject and replacement handling, counters and pacing |
| 4 | Delivery profiles and runs, client portal lead views, asset performance |
| 5 | Aggregate metric import, commercials with multi-currency, per-client do-not-contact enforcement, reporting, partner scorecards, notifications |
| 6 | Appointments, partner submission API, DSP connectors, optional platform-side call recording storage |

Currency handling is not deferrable to phase 5. Currency columns, minor-unit storage and the `ExchangeRate` table must exist from phase 1, because retrofitting currency onto amount columns after live data exists is a migration with no safe default.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Identity resolution quality degrades every downstream rule | Build normalisation and matching first, with an admin resolution queue from day one |
| Manual enrichment becomes the throughput bottleneck | Queue with ageing metrics and alerting; revisit automated enrichment if median age exceeds SLA |
| Counter drift under concurrent acceptance | Transactional counters, no background recomputation, reconciliation job as a detector rather than a corrector |
| Per-client delivery mapping proliferates | Mapping validated against a canonical field set; no bespoke transformation code per client |
| Channel type flexibility becomes unreadable configuration | Fixed capability flag set that the application actually reads; no open-ended key-value bag |
| Currency retrofitted after launch | Currency columns, minor-unit integers and rate snapshots present from phase 1 even before commercials ship |
| Per-account caps race under concurrent acceptance | Cap re-evaluated inside the acceptance transaction, not only at intake |
| Verification SLA set without evidence | Queue ageing captured from day one so the target is chosen from observed data |
