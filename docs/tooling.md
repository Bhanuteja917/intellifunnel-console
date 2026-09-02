# Tooling

| Tool | Version | How it was resolved |
|---|---|---|
| Node | v24.19.0 | `.nvmrc` (`24`), verified via `node --version` |
| pnpm | 11.25.0 | corepack (`corepack enable` + `pnpm --version`) |
| Postgres | 17 — recorded by controller; both existing Neon projects hold prior-iteration schemas, so a clean project must be provisioned by the user before first deploy | Neon MCP |

## Skills

- `shadcn/ui` — installed via `npx skills add shadcn/ui`. **Invoke it before writing or editing any UI code** (Task 23). Installed at `.agents/skills/shadcn`, symlinked at `.claude/skills/shadcn`. The same install also pulled in a bundled `migrate-radix-to-base` skill from the same `shadcn/ui` skills source; left in place alongside it.

## MCP servers

- **shadcn** — component and block discovery. Registered in `.mcp.json` via `pnpm dlx shadcn@latest mcp init --client claude`. Live verification of the shadcn MCP tools (e.g. a registry search for `button`) is pending the user's next Claude Code session start, since registering an MCP server requires a session restart that could not be performed in this session.
- **Neon** — database project, branch and connection-string management. Not exercised in this task: per controller decision, Neon was left untouched. Postgres major version (17) was supplied directly by the controller rather than read live via the Neon MCP server. New-project provisioning is deferred to the user because both existing Neon projects hold schemas from earlier iterations of this product and are unsafe to migrate into.

## Version policy

No dependency version is pinned in this plan. Every install uses the latest published version
(`pnpm add <pkg>` / `pnpm add <pkg>@latest`), and the lockfile is the record of what was resolved.
Pinning an older version requires an explicit reason and the user's approval.

## Notes on this task's run

- `pnpm --version` resolved to `11.25.0` on this machine at the time of this task, not the `11.5.2` noted in the task's prior context — corepack fetched the latest available `pnpm` release when first invoked. Recorded as observed, per the version policy above (nothing is pinned).
- `pnpm dlx shadcn@latest mcp init --client claude` had a side effect of creating a root `package.json` (with only `shadcn` as a devDependency) and an npm-format `package-lock.json`, installed via `npm` rather than `pnpm`. These were not required for the shadcn MCP server to function (`.mcp.json` invokes it via `npx shadcn@latest mcp`, independent of any local install), and an npm lockfile is inconsistent with this project's pnpm-based tooling. They were deleted before committing so Task 2 starts from a clean slate for the real `package.json`/`pnpm-lock.yaml`.
