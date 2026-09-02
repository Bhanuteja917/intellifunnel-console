# Product Requirements Document
## B2B Demand Generation Campaign & Lead Fulfilment Platform

**Version:** 0.2 (draft for review)
**Date:** 2 September 2026
**Status:** Pending stakeholder sign-off
**Changes in 0.2:** open questions resolved into a decisions log; multi-currency, payout triggers, per-account caps, per-client do-not-contact and external call references added to scope

---

## 1. Summary

The platform runs the full operational lifecycle of B2B demand generation campaigns for an agency that sits between clients who buy leads and partners who supply them.

It is not a general-purpose CRM. It is a campaign management and lead fulfilment system with three distinct user experiences: an internal admin console, a client portal, and a partner portal.

The central object is the Campaign. Every other object either configures a campaign, executes against it, or reports on it.

---

## 2. Problem statement

Campaign delivery is currently coordinated across spreadsheets, email and manual reconciliation. This produces four recurring failures:

1. **Lead quality disputes.** No single record of why a lead was accepted or rejected, so partner disputes are settled from memory.
2. **No delivery visibility.** Nobody can answer "are we on pace" without manually counting.
3. **Compliance exposure.** Consent evidence for syndicated leads lives with whoever collected it, not with the lead.
4. **Manual client reporting.** Every client update is assembled by hand.

The platform replaces all four with a single system of record.

---

## 3. Goals

| Goal | Measure |
|---|---|
| One system of record per lead, from intake to delivery | 100% of delivered leads traceable to source, verification and consent |
| Real-time delivery pacing | Every live campaign shows delivered vs. expected-to-date without manual work |
| Reduce lead rejection disputes | Every rejection carries a coded reason and evidence |
| Self-serve client visibility | Clients check status without contacting an account manager |
| Partner throughput without leaking commercials | Partners deliver against a spec they can see, blind to client identity and margin |

### Non-goals for v1

- Media buying execution. The platform records programmatic performance; it does not run ad delivery.
- Automated enrichment. Enrichment is manual in v1.
- Invoicing and accounting. The platform computes billable and payable amounts; finance systems issue the documents.
- Email marketing and nurture execution.
- Call recording storage. Verification calls are referenced from the telephony system by identifier; the platform does not hold the audio. The data model allows storage to be added later.
- Partner benchmarking against other partners. Partners see only their own performance.
- Public self-service signup. All external access is invite-only.

---

## 4. Users

### 4.1 Internal users (Admin portal)

| Role | Responsibility |
|---|---|
| Super Admin | Full access, user and role management, channel type configuration |
| Campaign Manager | Creates and configures campaigns, manages approvals, monitors pacing |
| Operations | Partner allocation, lead intake, verification, replacement management |
| Quality / Verification | Reviews leads, applies reject reasons, audits consent |
| Account Manager | Client relationship, reporting, order terms |
| Finance (read-mostly) | Billable and payable views |

### 4.2 Client users (Client portal)

Employees of the client organisation. Two roles:

- **Client Admin** — approves campaigns, invites colleagues, configures delivery destination.
- **Client Viewer** — read-only access to campaigns, leads and asset performance.

### 4.3 Partner users (Partner portal)

Employees of a lead supply partner. Two roles:

- **Partner Admin** — manages partner users, sees all allocations and performance.
- **Partner Operator** — submits leads, views campaign specs and rejection feedback.

### 4.4 Organisation model

Clients and partners are the same entity type with different capability flags. A single organisation may be both a client and a partner simultaneously.

---

## 5. Portals and access boundaries

### 5.1 Admin portal

Full visibility. Campaign configuration, partner allocation, lead intake and verification, reject management, pacing, commercials, channel type configuration, user administration, audit log.

### 5.2 Client portal

**Can see:** their campaigns and configuration, approval requests, accepted lead records in full, asset performance, channel performance, delivery pacing against contracted volume, reports.

**Cannot see:** partner identity, partner payout rates, agency margin, rejected leads, internal verification notes, other clients.

**Can do:** approve or reject a campaign before it goes live, upload target account and suppression lists, upload assets, configure the lead delivery destination and field mapping, invite colleagues.

**Cannot do:** reject leads after delivery. Delivery is final. Quality is settled before a lead reaches the client.

### 5.3 Partner portal

**Can see:** campaigns they are allocated to, the ICP specification, target account list, suppression rules, the asset and landing page, the qualification questions, required lead fields, their own allocation volume and pacing, their own submissions and rejection reasons, their own payout rate.

**Cannot see:** the client's identity (blind by default, overridable per allocation), the client's price, other partners, other partners' performance, the total campaign volume.

**Can do:** submit leads by file upload or form, request replacement resolution, view rejection feedback.

---

## 6. Core concepts

### 6.1 Campaign

Owned by one client. Carries ICP, assets, target accounts, suppression, flight dates, and one or more channels. Moves through a state machine with an approval gate.

### 6.2 Channel type (configurable)

Channel types are data, not code. Each defines whether it produces leads, whether it requires an asset, how it reports metrics, its pricing unit, its qualification form and its verification rules. Adding "MQL – 3 questions + tele-verification" is a configuration action, not a release.

Channel types are versioned. A live campaign keeps the version it was approved under.

### 6.3 Campaign channel

An instance of a channel type inside a campaign, with its own contracted quantity, unit price, cost budget and dates. Cost and revenue are tracked at this level, not at campaign level.

### 6.4 Asset and asset placement

Assets live in a reusable library owned by the client. An asset placement binds an asset to a specific campaign channel with a landing page and form. Performance rolls up per placement and per asset across campaigns.

Not all channels have assets. Programmatic display has impressions and no asset.

### 6.5 Engagement event

The moment a person completes a gated form to obtain an asset. This single record is simultaneously the download record, the consent artifact and the origin of the lead. It is not duplicated across separate analytics and lead tables.

### 6.6 Lead

A person plus an account plus a campaign channel, with a source, a verification status, a lifecycle status and an enrichment status held as separate dimensions.

### 6.7 Partner allocation

A share of a campaign channel's volume assigned to one partner, with its own cap, payout rate and window. Allocations are what partners see and what payouts are computed from.

### 6.8 Order

The commercial agreement: what the client is buying, at what unit price, per channel. Delivery counts reconcile against order lines.

---

## 7. Feature epics

Priority: **P0** = required for launch, **P1** = fast follow, **P2** = later.

### E1. Identity, organisations and invitations (P0)

- Single organisation model with client / partner / internal capability flags
- Invitation-only access for all client and partner users, by email
- Invitation lifecycle: send, resend, revoke, expire, accept
- Role assignment scoped to organisation
- Session management, password reset, email verification

### E2. Account and contact identity resolution (P0)

- Canonical Account records with normalised primary domain
- Account aliases and parent/child hierarchy
- Contact records deduplicated on normalised email
- Domain normalisation used by suppression, TAL matching and dedupe
- Manual merge tooling for admins

### E3. Campaign configuration (P0)

- Create campaign against a client organisation
- Structured ICP criteria (industry, size, revenue, geography, function, seniority, title)
- Per-campaign required lead field specification
- Target account list upload and matching to Accounts
- Suppression list upload, reusable and campaign-linked
- Per-account lead caps, set as a campaign-level default and overridable on individual target accounts
- Flight dates
- Campaign cloning with adjustments

### E4. Channel type configuration (P0)

- Admin CRUD for funnel stages and channel types
- Capability flags, metric field selection, pricing unit
- Qualification form builder with configurable questions and acceptable answers
- Versioning with snapshot on campaign approval

### E5. Asset library and placements (P0)

- Asset upload, versioning, type, language, ownership
- Reuse across campaigns
- Placement of an asset onto a campaign channel with landing page and form
- Asset performance reporting (downloads, conversion, by placement and across campaigns)

### E6. Approval workflow (P0)

- Internal approval that config matches the order
- Client approval with an immutable configuration snapshot recording who approved what and when
- Rejection with comments returning the campaign to draft
- Scheduled state between approval and flight start

### E7. Partner allocation (P0)

- Allocate volume from a campaign channel to a partner
- Per-allocation cap, payout rate, window and client-visibility flag
- Allocation appears in the partner portal only once active
- Reallocation mid-flight

### E8. Lead intake (P0)

- Partner file upload with column mapping, validation and per-row error reporting
- Internal bulk upload using the same pipeline
- Form capture producing engagement events
- Staging area: no lead is live until it passes intake

### E9. Validation and verification (P0)

- Automated rules: suppression match, cross-campaign dedupe, ICP fit, domain and role validation, required field spec, consent completeness
- Manual verification queue with tele-verification outcome, call recording reference and qualification answer review
- Controlled reject reason vocabulary with replaceable / non-replaceable classification
- Rejection feedback surfaced to the submitting partner
- Replacement tracking against the same allocation quota

### E10. Manual enrichment queue (P0)

- Leads requiring firmographics enter a work queue rather than blocking the pipeline
- Assignment, ageing and completion tracking
- Enrichment attaches to the lead and to the Account record where appropriate

### E11. Delivery (P0)

- Client-visible lead records in the portal
- Configured delivery integration per client or campaign: field mapping agreed before campaign start
- Delivery methods: webhook, SFTP file drop, CRM push, scheduled CSV
- Delivery run log with retry and failure alerting

### E12. Pacing and quota (P0)

- Authoritative, transactional delivery counters per campaign channel and per allocation
- Delivered vs. expected-to-date against the flight window
- Behind-pace and ahead-of-pace signals
- Per-partner rejection rate monitoring
- Volume caps enforced at intake

### E13. Metrics ingestion (P1)

- Event-level metrics derived from engagement events
- Aggregate daily metrics import for programmatic channels (impressions, clicks, spend)
- Import batch tracking and reconciliation

### E14. Commercials (P1)

- Order and order lines per campaign channel
- Billable amount from accepted volume
- Partner payable from accepted volume per allocation
- Multi-currency: the client billing currency and the partner payout currency are independent, and both convert to INR for internal reporting
- Manually maintained exchange rate table with rate snapshots taken at transaction date so historical figures do not move
- Partner payout trigger configurable per partner: monthly in arrears (by lead acceptance date), or on campaign close
- Margin view in INR, internal only

### E15. Reporting (P1)

- Client reporting: campaign performance, lead breakdown, asset performance, channel performance
- Partner scorecards: acceptance rate, throughput, reject reasons
- Internal operational dashboards
- Scheduled report delivery by email

### E16. Compliance and data governance (P0)

- Consent artifact stored with every syndicated lead: opt-in text version, timestamp, IP, source URL, asset
- Do-not-contact list scoped per client organisation, applying across all of that client's campaigns (P1)
- Personal data and consent retention of 12 months from acceptance, configurable platform-wide and per client
- Expiry anonymises the record rather than deleting it, preserving delivery counts and financial history
- Working calendar and holiday table driving business-day SLA calculation
- Configurable retention periods for call recordings and consent records
- Erasure request handling that preserves aggregate delivery counts

### E17. Audit and history (P0)

- Immutable audit log on every change touching quota, money, status or configuration
- Lead status history and campaign status history

### E18. Notifications (P1)

- Approval requests, pacing alerts, submission results, delivery failures, invitation events
- Per-user preferences

### E19. Appointments (P2)

- Appointment as a first-class object for BOFU appointment generation channels
- Scheduling, attendees, outcome tracking

---

## 8. Primary user journeys

### 8.1 Campaign launch

Account manager records the order. Campaign manager configures the campaign against it: ICP, lead field spec, target accounts, suppression, assets, channels with quantities and prices. Internal approval confirms the config matches the order. Client admin reviews and approves; the system snapshots the configuration. Campaign moves to Scheduled. At flight start it goes Live.

### 8.2 Partner delivery

Operations allocates volume across partners. The allocation appears in each partner's portal with the ICP, TAL, asset, questions and required fields, but no client name. The partner uploads leads. Validation runs immediately and returns per-row errors. Surviving leads enter the verification queue.

### 8.3 Verification and delivery

Verification reviews qualification answers, runs the tele-check where the channel requires it, and audits consent. Accepted leads increment the quota, become visible in the client portal, and are pushed to the client's configured destination in the agreed format. Rejected leads carry a coded reason back to the partner, who may submit a replacement if the reason is classified replaceable.

### 8.4 Close-out

At flight end or quota fulfilment the campaign completes. Final reconciliation produces billable volume by channel and payable volume by allocation. Under-delivery requires an explicit decision: extend, credit or partial-invoice.

---

## 9. Key business rules

1. Clients cannot reject leads after delivery. Accepted, delivered and billable are the same number.
2. A lead is never visible to the client before verification passes.
3. Partners are blind to client identity unless the allocation explicitly overrides.
4. Reject reasons come from a controlled vocabulary.
5. Only replaceable rejections create a partner replacement obligation.
6. Cost and revenue are tracked per campaign channel.
7. Channel type versions are frozen on campaign approval.
8. All client and partner users arrive by invitation. There is no public registration.
9. Client billing currency and partner payout currency are set independently. Both convert to INR, the agency reporting currency, using the rate in force on the transaction date.
10. Per-account lead caps apply where configured, as a campaign default or a per-account override, and are enforced at intake and again at acceptance.
11. Do-not-contact lists belong to the client, not the agency. There is no cross-client suppression.
12. Verification call evidence is a reference to an external telephony record, not stored audio.
13. Verification is expected within 3 business days of intake by default. The target is configurable platform-wide and per channel type, and the clock excludes weekends and holidays.
14. Monthly partner payouts are bounded by lead acceptance date in the Asia/Kolkata timezone, not delivery date.
15. Personal data and consent artifacts expire after 12 months from acceptance. Expiry anonymises the record; identifiers, counters and financial history survive.
16. A payout period is approved by a single user holding the Finance role. Approved payouts are immutable; corrections are adjustments on the next period.

---

## 10. Success metrics

- Median time from lead submission to verification decision, and percentage within the 3-business-day SLA
- Percentage of campaigns finishing within the flight window at full quota
- Rejection rate by partner and by reason
- Client portal weekly active usage per account
- Delivery integration failure rate
- Time to configure and launch a new campaign

---

## 11. Decisions log

| # | Question | Decision | Design consequence |
|---|---|---|---|
| 1 | Verification turnaround SLA | 3 business days, configurable | Platform-wide default set by Super Admin, overridable per channel type. Measured in business days against a working calendar |
| 2 | Partner payout timing | Both supported: monthly in arrears or on campaign close | Payout trigger is a per-partner setting resolved per allocation; monthly periods close on lead acceptance date |
| 3 | Target account volume caps | Both levels supported | Campaign-level default cap, overridable per target account entry |
| 4 | Maximum leads per account | Both levels supported | Same mechanism as above, enforced at intake and re-checked at acceptance |
| 5 | Do-not-contact ownership | Per client, added later | Model includes client scope from the start; enforcement lands in phase 5 |
| 6 | Call recordings | Not stored; external reference only | Verification record holds a telephony system identifier and system name. A storage key field is reserved for future use |
| 7 | Currency | Multi-currency, INR reporting currency | Every amount carries its currency. Converted to INR at transaction date with the rate persisted |
| 8 | Partner benchmarking | Not required now | Out of scope. Partner scorecards show own performance only |
| 9 | Exchange rate source | Manual entry in v1 | Finance maintains the rate table. An external feed writes to the same table later without application changes |
| 10 | Monthly payout boundary | Lead acceptance date | A lead accepted in March and delivered in April belongs to the March payout |
| 11 | Operating timezone | Asia/Kolkata | Governs payout period boundaries, pacing days and the SLA clock |
| 12 | Personal data retention | 12 months, configurable | Platform default with per-client override. Expiry anonymises; counters and financial records survive |
| 13 | SLA working calendar | Business days only | Configurable working days plus a holiday table. Weekends and holidays do not advance the SLA clock |
| 14 | Payout approval | Single approver, Finance role | No second approver, no value threshold |

### Still open

Nothing blocking. Two items to revisit before the relevant phase:

1. **Holiday calendar scope.** A single holiday list is assumed. If verification operates from more than one country, per-country calendars will be needed before the SLA reporting is trusted.
2. **Per-client retention overrides.** The model supports them, but no client requirement has been identified yet. Confirm at the first client whose contract specifies a retention term.
