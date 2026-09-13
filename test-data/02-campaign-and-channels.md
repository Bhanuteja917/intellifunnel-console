# Step 2 — Channel type, campaign, channel

## 2a. Publish a channel type (one-time, required)

The reseed created 5 `ChannelType` rows (Programmatic display, Content syndication, MQL,
HQL_TELE, Appointment generation) but **none has a published version yet** — the "Add
channel" dropdown on a campaign only lists channel types with `currentVersion > 0`, so it
will be empty until you publish one.

Go to **Channel Types**, find **"Marketing qualified lead"** (code `MQL`), open it and click
**Publish**. That's it — no fields to fill, it just cuts version 1 from the current config.

## 2b. Campaign

Go to **Campaigns → New Campaign**.

| Field | Value |
|---|---|
| Name | `SDD Test Campaign` |
| Code | `SDD-2026-Q3` (must be unique) |
| Client organization | `Acme Corp` |
| Currency | `USD` |
| Start date | `2026-09-01` |
| End date | `2026-12-31` |

Campaign is created as `draft`. While still draft, open it and configure:

### ICP criteria

| Dimension | Operator | Values | Mandatory |
|---|---|---|---|
| industry | in | `Software, SaaS, Financial Services` | ✅ |
| country | in | `United States, Canada` | ✅ |
| employeeRange | in | `51-200, 201-500, 501-1000` | ⬜ |

### Lead field specs

`email` is mandatory — the campaign cannot accept any lead upload without a spec keyed
`email`.

| Field key | Label | Data type | Required | Reject if missing |
|---|---|---|---|---|
| `email` | Email | email | ✅ | ✅ |
| `firstName` | First Name | string | ✅ | ✅ |
| `lastName` | Last Name | string | ✅ | ✅ |
| `companyName` | Company Name | string | ✅ | ✅ |
| `jobTitle` | Job Title | string | ⬜ | ⬜ |
| `phone` | Phone | phone | ⬜ | ⬜ |
| `industry` | Industry | string | ⬜ | ⬜ |

These field keys match the header row in [leads/leads-batch-1.csv](leads/leads-batch-1.csv)
and [leads/leads-batch-2-invalid.csv](leads/leads-batch-2-invalid.csv) 1:1, so the CSV
column → field mapping step in the upload UI is a straight match.

## 2c. Channel

On the campaign, **Add Channel**:

| Field | Value |
|---|---|
| Channel type | `Marketing qualified lead` (MQL) |
| Contracted quantity | `100` |
| Client unit price | `125.00` |
| Cost budget | `8000.00` |
| Start date | `2026-09-01` |
| End date | `2026-12-31` |

Dates must fall inside the campaign's 2026-09-01 → 2026-12-31 window, and the channel is
implicitly priced in the campaign's currency (USD).
