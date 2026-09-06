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

const CLIENT_NAV = [
  { href: "/client/leads", label: "Leads" },
  { href: "/client/reports", label: "Reports" },
] as const;

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

  return (
    <SidebarProvider>
      <AppSidebar user={user} nav={CLIENT_NAV} title="IntelliFunnelLabs" subtitle="Client Portal" />
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
