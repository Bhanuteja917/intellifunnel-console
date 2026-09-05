import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
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
  // First portal-level gate in the codebase — see Global Constraints.
  if (actor.portal !== "partner") {
    throw new ForbiddenError("This portal is for partner users");
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
