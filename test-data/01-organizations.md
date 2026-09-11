# Step 1 — Organizations

Go to **Organizations → New Organization**. At least one of Client/Partner/Internal must be
checked (server rejects if none are).

## Client org

| Field | Value |
|---|---|
| Name | `Acme Corp` |
| Legal name | `Acme Corporation Inc.` |
| Is client | ✅ |
| Is partner | ⬜ |
| Country | `United States` |
| Default billing currency | `USD` |

## Partner org

| Field | Value |
|---|---|
| Name | `Demo Partner Co` |
| Legal name | `Demo Partner Co LLC` |
| Is client | ⬜ |
| Is partner | ✅ |
| Country | `India` |
| Default payout currency | `USD` |

Valid currency codes accepted anywhere in the app: `INR, USD, EUR, GBP, AUD, SGD, AED, JPY`.

After creating both, note their names — the campaign/channel/asset/allocation forms pick
them from a dropdown, no need to record ids manually.
