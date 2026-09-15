import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { countPendingClientApprovals } from "@/lib/approvals/client-view";
import { ForbiddenError } from "@/lib/errors";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderBreadcrumb } from "@/components/header-breadcrumb";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// Reads the session via headers() per-request; not safe to prerender. See
// the same fix on (admin)/layout.tsx for why this matters at build time.
export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  // Chrome-only convenience — see the doc comment on assertPortal in
  // src/lib/auth/permissions.ts for why this must be try/caught here and
  // re-asserted, uncaught, at the top of every page in this portal.
  try {
    assertPortal(actor, "client");
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    return <>{children}</>;
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { name: true, email: true },
  });

  // Counted here so the badge is visible from every page in the portal, not
  // only the approvals inbox itself.
  const pendingApprovals = await countPendingClientApprovals(db, actor);

  const nav = [
    { href: "/client/campaigns" as const, label: "Campaigns" },
    { href: "/client/approvals" as const, label: "Approvals", badge: pendingApprovals },
    { href: "/client/reports" as const, label: "Reports" },
  ];

  return (
    <SidebarProvider>
      <AppSidebar user={user} nav={nav} title="IntelliFunnelLabs" subtitle="Client Portal" />
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
