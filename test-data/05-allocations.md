# Step 5 — Partner allocation

On the campaign's channel (MQL, from step 2c), go to **Allocations → New Allocation**:

| Field | Value |
|---|---|
| Partner organization | `Demo Partner Co` |
| Allocated quantity | `50` |
| Payout rate | `40.00` |
| Payout currency | `USD` (pre-filled from the partner org's default payout currency) |
| Start date | `2026-09-01` |
| End date | `2026-12-31` |
| Reveal client identity | ⬜ (leave off) |

Only one non-`ended` allocation is allowed per (partner, channel) pair — creating a second
one against the same partner while this one is still active/paused/draft will be rejected,
which is worth trying once to see the error.
