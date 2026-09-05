# Admin Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain admin sidebar with the full shadcn sidebar component (branded header, active-state nav, a user-profile footer with a logout action), and move the page breadcrumb trail out of individual pages into the shared top bar.

**Architecture:** `src/app/(admin)/layout.tsx` becomes an async server component that resolves the signed-in user (name/email) and passes it to a new client component `src/components/app-sidebar.tsx`, which renders the shadcn `Sidebar` primitives (`SidebarHeader`, `SidebarContent`, `SidebarFooter`) plus a `DropdownMenu`-based account menu wired to `authClient.signOut()`. The top bar (still in `layout.tsx`) gains a new client component `src/components/header-breadcrumb.tsx` that derives a breadcrumb trail from `usePathname()` against a small static label map — no per-page wiring needed. The one page that currently renders its own `Breadcrumb` (`campaigns/new/page.tsx`) has that block removed.

**Tech Stack:** Next.js App Router (server + client components), shadcn/ui (`sidebar`, `dropdown-menu`, `avatar`, `breadcrumb` — all already present in `src/components/ui/`), `better-auth/react` client (`src/lib/auth/client.ts`), Prisma (`src/lib/db.ts`).

**Spec:** none — this plan is scoped directly from a live UI review request in this session (existing sidebar was "plain", had no user-profile/logout UI, and breadcrumbs lived inline in page bodies instead of the top bar). There is no separate spec document; this plan's Global Constraints below are the binding requirements.

## Global Constraints

- Use the shadcn sidebar primitives already vendored at `src/components/ui/sidebar.tsx` (`SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarInset`, `SidebarTrigger`) — do not hand-roll sidebar markup or add a different sidebar library.
- Do not add new npm dependencies. `avatar.tsx`, `calendar.tsx`, `popover.tsx` were already added via `npx shadcn add` earlier this session; `dropdown-menu.tsx`, `breadcrumb.tsx`, `sidebar.tsx` already existed. If a task believes it needs a component that isn't in `src/components/ui/`, stop and report `NEEDS_CONTEXT` rather than installing something new.
- Logout must call `authClient.signOut()` from `@/lib/auth/client` (the same client `src/app/sign-in/sign-in-form.tsx` and `src/app/invite/[token]/accept-form.tsx` use for `signIn.email`), then `router.push("/sign-in")` and `router.refresh()` so the server re-evaluates the session on the next request.
- The existing nav items and hrefs in `src/app/(admin)/layout.tsx`'s `NAV` array must be preserved exactly (`/campaigns` Campaigns, `/channel-types` Channel types, `/organizations` Organisations, `/resolution-queue` Resolution queue) — do not invent nav entries for pages that don't exist yet (no Dashboard, Clients, Partners, TAL Lists, or Activity routes exist in this codebase).
- `requireActor()` (from `@/lib/auth/require`) throws `ForbiddenError` when there's no session; the `(admin)` route group already has `src/app/(admin)/error.tsx` as a catch boundary, so a layout that calls `requireActor()` and throws is handled the same way any admin page already is — no new error handling needed.
- TypeScript must pass with zero errors: `npx tsc --noEmit`. This is the only required check in this codebase for UI-only changes (there is no lint-on-commit hook enforced here; run `npx eslint <changed files>` too and fix anything it flags, but tsc is the gate).

---

## Task 1: Rebuild the sidebar with a branded header and a user-profile/logout footer

**Files:**
- Create: `src/components/app-sidebar.tsx`
- Modify: `src/app/(admin)/layout.tsx`

**Interfaces:**
- Produces: `AppSidebar`, a client component with props `{ user: { name: string; email: string } }`, default export not used — named export `export function AppSidebar(...)`. Renders the full `<Sidebar>` (header, content with nav, footer with account menu) and must be rendered as a sibling of `<SidebarInset>`, both inside `<SidebarProvider>`, exactly like the current layout's structure.
- Consumes: nothing from another task. Task 2 will later add a breadcrumb component into the same `layout.tsx` header `<header>` element this task edits — leave that header's existing `<SidebarTrigger />` in place and don't restructure the header element beyond what's specified below, so Task 2's edit lands cleanly.

- [ ] **Step 1: Read the current layout for reference**

  Read `src/app/(admin)/layout.tsx` in full first — it's short (under 45 lines). It currently exports a plain (non-async) `AdminLayout` function with a `NAV` const array of `{ href, label }`, and renders `SidebarProvider > (Sidebar > SidebarContent > SidebarMenu of NAV items) + (SidebarInset > header(SidebarTrigger) + main)`.

- [ ] **Step 2: Create `src/components/app-sidebar.tsx`**

  ```tsx
  "use client";

  import Link from "next/link";
  import { usePathname, useRouter } from "next/navigation";
  import { LogOut, ShapesIcon, User } from "lucide-react";
  import { authClient } from "@/lib/auth/client";
  import { Avatar, AvatarFallback } from "@/components/ui/avatar";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
  } from "@/components/ui/sidebar";

  const NAV = [
    { href: "/campaigns", label: "Campaigns" },
    { href: "/channel-types", label: "Channel types" },
    { href: "/organizations", label: "Organisations" },
    { href: "/resolution-queue", label: "Resolution queue" },
  ] as const;

  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    const first = parts[0]![0]!;
    const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
    return (first + last).toUpperCase();
  }

  export function AppSidebar({ user }: { user: { name: string; email: string } }) {
    const pathname = usePathname();
    const router = useRouter();

    async function logout() {
      await authClient.signOut();
      router.push("/sign-in");
      router.refresh();
    }

    return (
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <ShapesIcon className="size-6 shrink-0" />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">IntelliFunnelLabs</span>
              <span className="text-xs text-muted-foreground">Admin Console</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)}>
                  <Link href={item.href}>{item.label}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                <Avatar className="size-7">
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col text-left leading-tight">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <User />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }
  ```

  Notes for the "Profile" item: there is no profile page in this codebase yet, so it's `disabled` rather than linking somewhere fake. Do not build a profile page — out of scope for this task.

- [ ] **Step 3: Wire it into `src/app/(admin)/layout.tsx`**

  Replace the whole file with:

  ```tsx
  import { db } from "@/lib/db";
  import { requireActor } from "@/lib/auth/require";
  import { AppSidebar } from "@/components/app-sidebar";
  import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
  } from "@/components/ui/sidebar";

  export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const actor = await requireActor();
    const user = await db.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { name: true, email: true },
    });

    return (
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger />
          </header>
          <main className="p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    );
  }
  ```

  This drops the old inline `NAV` const and the manual `Sidebar`/`SidebarContent`/`SidebarMenu` markup from `layout.tsx` entirely — that's now inside `AppSidebar`. The `<header>` element is deliberately left minimal (just the trigger) — Task 2 adds a breadcrumb next to it; don't add one here.

- [ ] **Step 4: Verify**

  Run `npx tsc --noEmit` from the repo root — must be clean. Then start (or confirm already running) `npm run dev` / `next dev` and manually check in a browser signed in as `bhanu@intellifunnel.io`: the sidebar shows the IntelliFunnelLabs header, the four nav links with the current page highlighted, and a footer row with initials avatar + name + email that opens a dropdown with a disabled "Profile" item and a working "Log out" that lands back on `/sign-in`. Report what you saw, including the exact name/email that rendered (confirms the `db.user` lookup actually ran).

- [ ] **Step 5: Commit**

  `git add src/components/app-sidebar.tsx src/app/(admin)/layout.tsx && git commit -m "..."` — write your own concise message.

---

## Task 2: Move the breadcrumb trail into the shared top bar

**Files:**
- Create: `src/components/header-breadcrumb.tsx`
- Modify: `src/app/(admin)/layout.tsx:` the `<header>` element Task 1 left in place
- Modify: `src/app/(admin)/campaigns/new/page.tsx`

**Interfaces:**
- Consumes: the `<header className="flex h-12 items-center gap-2 border-b px-4">...</header>` block Task 1 put in `layout.tsx`, containing just `<SidebarTrigger />`.
- Produces: `HeaderBreadcrumb`, a client component, default-exportable or named (`export function HeaderBreadcrumb()`), no props — it reads the route itself via `usePathname()`.

- [ ] **Step 1: Read the two files this task touches**

  Read `src/app/(admin)/layout.tsx` (as left by Task 1) and `src/app/(admin)/campaigns/new/page.tsx` in full.

- [ ] **Step 2: Create `src/components/header-breadcrumb.tsx`**

  A pathname-derived breadcrumb — no per-page wiring, so it works for every current and future admin route without touching those pages. Static segments get a label from a small map; a segment not in the map that looks like an opaque database id (no spaces, length over 10) is rendered as a plain, non-linked "Details" crumb instead of the raw id.

  ```tsx
  "use client";

  import Link from "next/link";
  import { Fragment } from "react";
  import { usePathname } from "next/navigation";
  import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
  } from "@/components/ui/breadcrumb";

  const SEGMENT_LABELS: Readonly<Record<string, string>> = {
    campaigns: "Campaigns",
    new: "New Campaign",
    "channel-types": "Channel types",
    organizations: "Organisations",
    "resolution-queue": "Resolution queue",
  };

  function labelFor(segment: string): string {
    const known = SEGMENT_LABELS[segment];
    if (known !== undefined) return known;
    if (!segment.includes(" ") && !segment.includes("-") && segment.length > 10) return "Details";
    return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
  }

  export function HeaderBreadcrumb() {
    const pathname = usePathname();
    const segments = pathname.split("/").filter(Boolean);

    if (segments.length === 0) return null;

    let href = "";
    const crumbs = segments.map((segment) => {
      href += `/${segment}`;
      return { label: labelFor(segment), href };
    });

    return (
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <Fragment key={crumb.href}>
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    );
  }
  ```

- [ ] **Step 3: Add it to the top bar in `layout.tsx`**

  Change only the `<header>` line:

  ```tsx
  <header className="flex h-12 items-center gap-2 border-b px-4">
    <SidebarTrigger />
    <HeaderBreadcrumb />
  </header>
  ```

  and add `import { HeaderBreadcrumb } from "@/components/header-breadcrumb";` to the top of the file.

- [ ] **Step 4: Strip the inline breadcrumb out of `campaigns/new/page.tsx`**

  That page currently renders its own `<Breadcrumb>...</Breadcrumb>` block (with `Campaigns` / `New Campaign`) above the "Back to Campaigns" link. Delete that `<Breadcrumb>` block and its now-unused imports (`Breadcrumb`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbList`, `BreadcrumbPage`, `BreadcrumbSeparator` from `@/components/ui/breadcrumb`). Leave the "Back to Campaigns" link (with the `ArrowLeft` icon) and the `<h1>New Campaign</h1>` / description paragraph exactly as they are — those aren't breadcrumbs, they're page furniture, out of scope here. The new `HeaderBreadcrumb` will show `Campaigns / New Campaign` for this route automatically once Task 1 + this task's Step 3 are in place, because the label map already has `campaigns` and `new`.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Then in the browser: visit `/campaigns` (top bar shows just "Campaigns", no separator since it's one segment — that's correct, not a bug), `/campaigns/new` (top bar shows "Campaigns / New Campaign", clicking "Campaigns" navigates back), and `/campaigns/<some-id>` for an existing campaign (top bar shows "Campaigns / Details" since the id isn't in the label map — expected per this task's design, not a defect). Confirm `campaigns/new/page.tsx` no longer renders a second breadcrumb above the page title. Report exactly what each route showed.

- [ ] **Step 6: Commit**

  `git add src/components/header-breadcrumb.tsx src/app/(admin)/layout.tsx "src/app/(admin)/campaigns/new/page.tsx" && git commit -m "..."` — write your own concise message.
