# Session handoff — intellifunnel-console, Phase 1

Written 2026-09-02. Assume the reader has **zero** context from the prior session.

---

## 1. What this project is

A B2B demand-generation campaign and lead-fulfilment platform for an agency sitting between clients who buy leads and internal employess and partners who supply them. Three portals: internal admin, client, partner.

Two spec documents at the repo root, both authoritative:

- `prd.md` — Product Requirements, v0.2. Users, epics, business rules, decisions log.
- `srs.md` — Software Requirements Spec, v0.2. Tech stack, full data model, state machines, functional requirements (`AUTH-*`, `FR-*`, `CUR-*`, `NFR-*`, `DEP-*`), and the six-phase plan in §10.

**The SRS is the binding authority.** The implementation plan argues from it; where they disagree, the SRS wins.

## 2. What is being built right now

**SRS §10 Phase 1 only** — organisations, invitations, RBAC, identity resolution, campaign configuration, channel type admin, approval workflow. Plus the currency infrastructure §10 forbids deferring, plus the DEP-6 seed data.

Phases 2–6 (assets, form capture, allocation, lead intake, verification, delivery, metrics, commercials) are **out of scope** and get their own plans later.

The plan: **`docs/superpowers/plans/2026-09-02-phase-1-foundation.md`** — 24 tasks, ~9200 lines, every task carrying real test code, real implementation code and a commit step.

## 3. Repository state

```
branch: feat/phase-1-foundation
HEAD:   812d68f
        812d68f fix: remove leftover npm-owned node_modules, correct tooling.md claim
        be30511 chore: configure node 24, shadcn/ui skill and shadcn + neon mcp servers
        467f32b docs: add PRD, SRS and phase 1 implementation plan   <- also tip of `main`
```

On disk: `.agents/`, `.claude/skills/`, `.mcp.json`, `.nvmrc`, `.gitignore`, `docs/`, `prd.md`, `srs.md`, `skills-lock.json`, `.superpowers/` (gitignored scratch).

**No application code exists yet.** No `package.json`, no `node_modules`, no `src/`. Task 2 creates them. That is expected, not a missing step.

Toolchain verified present: Node v24.19.0, pnpm 11.25.0.

## 4. Method in use

**`superpowers:subagent-driven-development`** — one fresh implementer subagent per task, a task review after each (spec compliance + code quality), a fix loop capped at 5 rounds, then a whole-branch review at the end.

Workspace for this plan (gitignored):
`.superpowers/sdd/2026-09-02-phase-1-foundation/`

| File | What it is |
|---|---|
| `progress.md` | **The ledger. Read this first.** Survives compaction; it is the recovery map. |
| `task-N-brief.md` | Task N's full text, extracted for the implementer |
| `task-N-report.md` | Implementer's report for task N |
| `review-<base>..<head>.diff` | Review packages |

Helper scripts live in the skill directory:
`/Users/bhanuteja-intellifunel/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/` — `sdd-workspace`, `task-brief`, `review-package`.

**The ledger is the source of truth for progress, not this file and not conversation memory.** A task with a `Task <N>: complete` line is done — do not re-dispatch it.

## 5. Progress

- **Task 1 (tooling, skills, MCP): COMPLETE** — `467f32b..812d68f`, review clean after one fix round.
  - Node 24 verified, `.nvmrc` written
  - `shadcn/ui` skill installed via `npx skills add shadcn/ui` (content in `.agents/skills/shadcn/`, symlinked at `.claude/skills/shadcn`, tracked by `skills-lock.json`)
  - `.mcp.json` written registering the shadcn MCP server
  - `docs/tooling.md` recording resolved versions, skills, MCP servers, version policy
- **Tasks 2–24: NOT STARTED.** Task 2's brief is already generated at `.superpowers/sdd/2026-09-02-phase-1-foundation/task-2-brief.md`; its BASE is `812d68f`.

Task 1 is marked in the plan as a deliberate **BREAKPOINT** — the prior session halted there by design, because the two open items in §6 need the user.

## 6. Open items needing the user

**a. Neon — nothing has been provisioned, deliberately.**

The user's Neon org holds two projects that look like this console, and **both already contain schemas from earlier iterations of this same product**:

| Project | id | Contents |
|---|---|---|
| `intellifunnellabs-conosle` | `frosty-hill-10728427` | `campaign`, `lead`, `client`, `channel`, `tal_list`, `target_account`, `client_invitation`, Better Auth tables, **populated `_prisma_migrations`**, plus a `drizzle` schema |
| `if-console` | `withered-sea-16127051` | `campaigns`, `campaign_channels`, `companies`, `approvals`, `campaign_assets`, Better Auth tables |

Migrating Phase 1 into either would collide with live tables. A **new, clean Neon project** is required before the first real deploy. Creating one spends on the user's org, so it was left to them.

**This does not block Tasks 2–24.** Migrations are authored against local docker-compose Postgres and tests run on Testcontainers. Neon matters at deploy time only. (Note: `task-1-report.md` says Neon is needed "before Task 3" — that statement is wrong; ignore it.)

Postgres major version for this project is **17** — both existing projects run 17, and the Testcontainers harness in Task 3 reads `POSTGRES_MAJOR`.

**b. shadcn MCP server — verify it is live.**

`.mcp.json` is written and content-verified, but an MCP server only activates at session start. The prior session could not restart itself. Run `/mcp` and confirm `shadcn` is connected. If it is not, Task 23 can still proceed using the `shadcn@latest add` CLI, but registry **block** discovery is weaker without it, and blocks-before-components is a user requirement.

## 7. User preferences that bind all future work

These came from the user directly and are non-negotiable without their approval:

1. **Node 24 (current LTS)** everywhere — `.nvmrc`, `engines`, all Dockerfile stages.
2. **No pinned dependency versions.** Every install resolves latest (`pnpm add <pkg>`); `pnpm-lock.yaml` is the record. Installing an older version requires a stated reason **and the user's explicit approval** — it is not the implementer's judgement call.
3. **UI is assembled from shadcn/ui.** Invoke the `shadcn` skill before writing any UI code. Search the registry for a **block** first; compose from shadcn components second. **Writing a component from scratch requires the user's approval before it is written.**
4. **Client state uses Zustand, not React Context.** Stores in `src/lib/stores/`. The one permitted exception is shadcn's own `SidebarProvider`.
5. **Subagents run on Sonnet** unless there is a reason to escalate.
6. Caveman mode is active in the user's session (terse output; code and commits written normally).

## 8. Rulings carried forward

Recorded in the ledger. All reversible. R4, R5 and R6 are **plan defects found in the pre-flight scan and must be honoured when their task runs** — a cold implementer following the plan text literally will get them wrong.

| # | Ruling | Cost if wrong |
|---|---|---|
| R1 | `git init` was done during setup; `main` holds a docs-only commit and work happens on `feat/phase-1-foundation`. Task 1's implementer was told to skip `git init`. | nil |
| R2/R8 | Neon left untouched, no project provisioned — see §6a. | No preview/staging DB until provisioned; zero impact on Tasks 2–24 |
| R3 | Writing and content-verifying `.mcp.json` was the whole obligation; live verification deferred to a session restart. | shadcn MCP unavailable at Task 23; CLI fallback works |
| **R4** | **Task 8's audit-trigger migration directory must carry a timestamp strictly greater than the newest existing migration — NOT the plan's literal `20260902000000`, which may sort before migrations created by `migrate dev` on the same day.** | `migrate deploy` fails loudly; a rename fixes it |
| **R5** | **Task 10's Better Auth CLI (`generate --output prisma/schema.prisma`) must APPEND. The implementer must verify every pre-existing model survives before migrating.** | Schema clobbered; recoverable from git |
| **R6** | **`src/lib/errors.ts` belongs to Task 4 despite being absent from that task's Files list — Step 4 of the task creates it and Task 5 onward import it.** | nil |
| R7 | Task 19 importing the `ImportResult` type from Task 18's module stands; no shared types file. | Mild coupling |
| R9 | The bundled `migrate-radix-to-base` skill that `skills add` pulled alongside shadcn stays, rather than hand-deleting half of what `skills-lock.json` tracks. | ~2900 lines of unused markdown vendored |
| R10 | Honoured the plan's Task 1 breakpoint rather than the SDD skill's continuous-execution default. | One round-trip of latency |

## 9. How to resume

```
/superpowers:subagent-driven-development
```

Then, before dispatching anything:

1. Read `.superpowers/sdd/2026-09-02-phase-1-foundation/progress.md`. Its first line names this plan; tasks with a `complete` line are done. Resume at **Task 2**.
2. Do **not** re-run the pre-flight conflict scan — it is already in the ledger (25 cross-task rows, 24 self-consistency rows) with its rulings.
3. Record `BASE = 812d68f` before dispatching Task 2's implementer.
4. Task 2's brief already exists; generate briefs for Tasks 3+ with `scripts/task-brief`.
5. In Task 3's dispatch, correct the report's inaccurate claim that Neon is needed before Task 3 — it is not.

Per-task loop: dispatch implementer (Sonnet) → review package via `scripts/review-package PLAN BASE HEAD` → task reviewer → fix loop if Critical/Important → ledger the completion line → next task.

## 10. Verification gates for the whole phase

From the plan's completion checklist — the phase is not done until all of these hold:

- `pnpm test` green against a real Postgres, `pnpm typecheck` clean under `strict` + `noUncheckedIndexedAccess`, `pnpm lint` clean, `pnpm build` emits standalone output
- `pnpm db:seed` run twice yields identical row counts (DEP-6 idempotence)
- Seeded: 10 roles, 7 platform settings, 4 funnel stages, 5 channel types, ≥20 reject reasons
- `UPDATE`/`DELETE` on `AuditLog` rejected by the database (NFR-A-2)
- Every monetary column stores integer minor units beside an explicit currency column (CUR-1, CUR-6)
- No service function reads data without an `Actor` argument (AUTH-8)
- `docker build` succeeds and the container answers `/api/health/ready`
- Node 24 in `.nvmrc`, `engines`, and all three Dockerfile stages
- Every file in `src/components/ui/` produced by the shadcn CLI; no from-scratch component without approval
- `grep -rn "createContext" src/ | grep -v components/ui` returns nothing
