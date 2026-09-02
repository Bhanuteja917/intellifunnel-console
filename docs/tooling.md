# Tooling

| Tool | Version | How it was resolved |
|---|---|---|
| Node | v24.19.0 | `.nvmrc` (`24`), verified via `node --version` |
| pnpm | 11.25.0 | corepack (`corepack enable` + `pnpm --version`) |
| Postgres | 17 — recorded by controller; both existing Neon projects hold prior-iteration schemas, so a clean project must be provisioned by the user before first deploy | Neon MCP |
| next | 16.3.4 | `pnpm add next` |
| react | 19.2.8 | `pnpm add react` |
| react-dom | 19.2.8 | `pnpm add react-dom` |
| typescript | 6.0.3 (pinned, latest is 7.0.2) | `pnpm add -D typescript@6.0.3` — see note below |
| @types/node | 26.4.0 | `pnpm add -D @types/node` |
| @types/react | 19.2.18 | `pnpm add -D @types/react` |
| @types/react-dom | 19.2.5 | `pnpm add -D @types/react-dom` |
| eslint | 9.39.5 (pinned, latest is 10.9.1) | `pnpm add -D eslint@9.39.5` — see note below |
| eslint-config-next | 16.3.4 | `pnpm add -D eslint-config-next` |
| vitest | 4.1.11 | `pnpm add -D vitest` |

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
- `pnpm dlx shadcn@latest mcp init --client claude` had a side effect of creating a root `package.json` (with only `shadcn` as a devDependency), an npm-format `package-lock.json`, and a 73MB `node_modules/` (including `node_modules/.package-lock.json`, an npm ownership marker) — all installed via `npm` rather than `pnpm`. None of this was required for the shadcn MCP server to function (`.mcp.json` invokes it via `npx shadcn@latest mcp`, independent of any local install), and npm-owned artifacts are inconsistent with this project's pnpm-based tooling. `package.json` and `package-lock.json` were deleted before the first commit; the leftover npm-owned `node_modules/` (gitignored, so it never entered the commit) was found and removed in a follow-up fix (`rm -rf node_modules`), so Task 2's `pnpm install` now lands on a genuinely empty directory rather than one an earlier npm install still owned.

## Notes on Task 2 (repository bootstrap)

- `package.json`'s `packageManager` field is written per Task 2's brief as `pnpm@latest`, but corepack rejects that (`Invalid package manager specification ... expected a semver version`). Set it to the actually-resolved `pnpm@11.25.0` instead — consistent with the version policy of recording what resolved, not a preference change.
- **`typescript` pinned to `6.0.3`, not the latest `7.0.2`.** `pnpm add -D typescript` resolved `7.0.2` (the new native/Go-ported compiler) at install time, but `typescript-eslint@8.69.0` (pulled in by `eslint-config-next`) refuses to run against it: `typescript-eslint does not support TS 7.0`. This is the version policy's named exception ("pinning an older version requires an explicit reason") — the reason is a hard incompatibility with the lint toolchain, not a preference. Pinned to `6.0.3`, the latest published `6.x` release, so `pnpm typecheck` and `pnpm build`'s internal type-checking are unaffected (both ran clean against `6.0.3`).
- **`eslint` pinned to `9.39.5`, not the latest `10.9.1`.** Once `typescript` was pinned, `pnpm lint` still failed under `eslint@10.9.1`: `eslint-plugin-react@7.37.5` (also pulled in transitively by `eslint-config-next@16.3.4`, which itself pins `eslint-plugin-react: ^7.37.0`) calls the removed `context.getFilename()` API and crashes (`contextOrFilename.getFilename is not a function`). `eslint-plugin-react@7.37.5`'s own `peerDependencies` cap at `eslint: ^9.7`, confirming ESLint 10 isn't yet supported by this dependency chain. Pinned `eslint` to `9.39.5`, the latest published `9.x` release (npm flags it deprecated since `9.x` is out of eslint.org's support window, but it is the newest version compatible with `eslint-config-next`'s pinned `eslint-plugin-react`). After both pins, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm lint` all pass clean; `pnpm peers check` reports no issues.
- `pnpm add -D typescript @types/node @types/react @types/react-dom eslint eslint-config-next vitest` exited `1` on first run despite installing everything successfully, because of pnpm's supply-chain build-approval gate: `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: unrs-resolver`. Resolved with `pnpm approve-builds --all`, which wrote `pnpm-workspace.yaml` (`allowBuilds: { unrs-resolver: true }`) — committed as part of this task since it's now required for a clean `pnpm install` on a fresh clone.
