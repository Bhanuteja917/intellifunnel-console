import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderBreadcrumb } from "@/components/header-breadcrumb";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// Every route here reads the session via headers() and hits the DB per-actor;
// none of it is safe to prerender. Some pages (assets, campaigns, ...) have
// no searchParams to force dynamic rendering on their own, so Next tries to
// statically export them at build time and hits "Not authenticated" (no
// request context available during build).
export const dynamic = "force-dynamic";

const ADMIN_NAV = [
  { href: "/campaigns", label: "Campaigns", permission: "campaign:read" },
  { href: "/channel-types", label: "Channel types", permission: "channelType:read" },
  { href: "/organizations", label: "Organisations", permission: "organization:read" },
  { href: "/verification", label: "Verification", permission: "lead:read" },
  { href: "/assets", label: "Assets", permission: "asset:read" },
  { href: "/consent-texts", label: "Consent texts", permission: "asset:read" },
  { href: "/reports", label: "Reports", permission: "report:read" },
  { href: "/compliance", label: "Compliance", permission: "compliance:read" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { name: true, email: true },
  });

  const nav = ADMIN_NAV.filter((item) => hasPermission(actor, item.permission));

  return (
    <SidebarProvider>
      <AppSidebar user={user} nav={nav} title="IntelliFunnelLabs" subtitle="Admin Console" />
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
