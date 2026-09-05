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

const ADMIN_NAV = [
  { href: "/campaigns", label: "Campaigns", permission: "campaign:read" },
  { href: "/channel-types", label: "Channel types", permission: "channelType:read" },
  { href: "/organizations", label: "Organisations", permission: "organization:read" },
  { href: "/resolution-queue", label: "Resolution queue", permission: "account:write" },
  { href: "/verification", label: "Verification", permission: "lead:read" },
  { href: "/assets", label: "Assets", permission: "asset:read" },
  { href: "/consent-texts", label: "Consent texts", permission: "asset:read" },
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
