import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderBreadcrumb } from "@/components/header-breadcrumb";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const PARTNER_NAV = [{ href: "/partner/allocations", label: "Allocations" }] as const;

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  // Chrome-only convenience: this is the first portal-level gate in the
  // codebase, but a layout-level check does NOT stop the route segment below
  // it from rendering or appearing in the RSC payload (Next.js's own docs
  // warn about this for layout-only auth checks — see the `assertPortal` doc
  // comment). It only spares a non-partner actor from seeing partner-shaped
  // sidebar chrome before the real, page-level check runs.
  //
  // Deliberately caught rather than left to propagate: `layout.tsx` and
  // `page.tsx` run concurrently for the same request (Next renders every
  // segment's Server Component up front, not strictly parent-then-child),
  // and empirically (verified against both `next dev` and a production
  // build — matching the `$RX` retry call's digest back to the layout vs.
  // page source chunk) it is *this* layout's own uncaught throw, not the
  // page's, that wins the race for which error reaches the browser — i.e.
  // an uncaught throw here would silently reintroduce the exact bug this
  // file exists to fix (the wrong, root-worded boundary). Falling through to
  // bare `{children}` instead lets the page's own `assertPortal` call — see
  // e.g. `src/app/partner/allocations/page.tsx` — be the one that throws,
  // which *is* inside a segment `partner/error.tsx` wraps.
  try {
    assertPortal(actor, "partner");
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    return <>{children}</>;
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { name: true, email: true },
  });

  return (
    <SidebarProvider>
      <AppSidebar user={user} nav={PARTNER_NAV} title="IntelliFunnelLabs" subtitle="Partner Portal" />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <HeaderBreadcrumb />
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
