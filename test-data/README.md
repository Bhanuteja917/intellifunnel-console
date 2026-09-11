# Test data — manual UI walkthrough

Dev DB was fully wiped (`prisma migrate reset`) then reseeded with reference data only
(roles, channel types, funnel stages, reject reasons, platform settings — no orgs, users,
campaigns, leads, assets). This folder has everything needed to manually rebuild a working
test dataset through the UI, in order.

## Login

A bootstrap SUPER_ADMIN was created for you (no self-signup exists in this app — the only
way to create the very first account is a one-off script, already run):

| Field | Value |
|---|---|
| URL | http://localhost:3000/sign-in |
| Email | `admin@intellifunnel.io` |
| Password | `AdminPass123!` |
| Org | Intellifunnel Internal |

## Order of operations

1. **[01-organizations.md](01-organizations.md)** — create the client org and partner org.
2. **[02-campaign-and-channels.md](02-campaign-and-channels.md)** — publish a channel type
   (one-time, required before any channel can be added), then create the campaign, its ICP
   criteria, lead field specs, and a channel.
3. **[03-assets-and-placements.md](03-assets-and-placements.md)** — consent text, assets
   (upload the PDFs in [assets/](assets/)), and a placement linking an asset to the channel.
4. **[04-leads.md](04-leads.md)** — upload the CSVs in [leads/](leads/) and what each row is
   expected to do.
5. **[05-allocations.md](05-allocations.md)** — partner allocation on the channel.

Each doc lists exact field values to type in. Do them in order — later steps reference IDs
you create in earlier ones (e.g. the campaign needs the client org's id from step 1).
