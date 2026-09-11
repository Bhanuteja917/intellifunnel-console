# Step 3 — Consent text, assets, placement

## 3a. Consent text

Go to **Consent Texts → New**.

| Field | Value |
|---|---|
| Name | `Standard Marketing Consent` |
| Language | `en` |
| Effective from | `2026-09-01` |
| Body | `By submitting this form, you consent to Acme Corp and its marketing partners contacting you about the products and services described. You may withdraw consent at any time.` |

Version is auto-assigned (starts at 1). This is optional on a placement but exercises the
consent-text picker.

## 3b. Assets

Two sample PDFs are provided in [assets/](assets/): `whitepaper-sample.pdf` and
`ebook-sample.pdf`. Any file type/size actually works (upload isn't validated), these are
just realistic placeholders.

Go to **Assets → New Asset**:

| Field | Value (asset 1) | Value (asset 2) |
|---|---|---|
| Name | `Acme Corp Whitepaper — Cloud Security` | `Acme Corp eBook — Buyer's Guide` |
| Owner organization | `Acme Corp` | `Acme Corp` |
| Type | `whitepaper` | `ebook` |
| Language | `en` | `en` |

The owner-org dropdown only lists orgs with `isClient: true` and `status: active`, so Acme
Corp must exist first (step 1).

After creating each asset, open it and use **Upload Version** to attach the matching PDF
(`whitepaper-sample.pdf` → asset 1, `ebook-sample.pdf` → asset 2). Then set the asset's
status to **active** — a placement can't be created against a `draft` asset.

## 3c. Placement

On the campaign's channel (the MQL channel from step 2c), go to **Placements → New
Placement**:

| Field | Value |
|---|---|
| Asset version | the version you just uploaded for asset 1 (whitepaper) |
| Landing page URL | `https://example.com/lp/cloud-security-whitepaper` |
| Form slug | `acme-cloud-security-wp` (must be globally unique) |
| Consent text version | `Standard Marketing Consent` v1 |

This channel's `requiresAsset` is true (MQL), so the campaign's approval flow won't
complete without at least one active placement.
