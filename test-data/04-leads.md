# Step 4 — Lead upload

There is no manual single-lead form — leads only come in via CSV upload on the campaign's
**Leads → Upload** page. Upload the two files in [leads/](leads/) **in order** — batch 2
deliberately duplicates a batch-1 email to exercise the duplicate check, so batch 1 must
land first.

Both files' headers already match the lead field spec keys from step 2b
(`email, firstName, lastName, companyName, jobTitle, phone, industry`), so the column →
field mapping step is a 1:1 match — no relabeling needed.

## Upload form

| Field | Value |
|---|---|
| Channel | the MQL channel from step 2c |
| Source type | `internal` |
| Partner organization | leave unset (only needed for `partner` source type) |
| File | `leads-batch-1.csv`, then later `leads-batch-2-invalid.csv` |

## leads-batch-1.csv — expect all 8 rows to pass

Straightforward valid rows: real-looking business email domains (not gmail/yahoo/etc,
which are rejected as generic), phone numbers 7–15 digits (a bare 10-digit number is
treated as +91), all required fields populated.

## leads-batch-2-invalid.csv — expect 3 rejected, 2 accepted

| Row | Email | Expected outcome |
|---|---|---|
| 1 | *(blank)* | rejected — `email` is required + reject-if-missing |
| 2 | `test.user@gmail.com` | rejected — gmail.com is a blocked free/generic domain |
| 3 | `bad.phone@beta-corp.com` | rejected — phone `12345` is under the 7-digit minimum |
| 4 | `jane.doe@acmecorp.com` | rejected — duplicate of a lead already in this campaign channel (from batch 1) |
| 5 | `sam.lee@northwind.io` | accepted |

After both uploads, the campaign's Leads page should show 9 leads total (8 from batch 1 +
1 from batch 2) and the submission-errors view should show the 4 rejected rows from batch 2
with their reasons — good for testing the error-reporting UI.

## Optional: partner-sourced batch

Once step 5's allocation exists, you can re-upload `leads-batch-1.csv` (rename it first,
or expect all-duplicate rejections) with **Source type = partner** and **Partner
organization = Demo Partner Co** to exercise the partner-attribution path instead.
