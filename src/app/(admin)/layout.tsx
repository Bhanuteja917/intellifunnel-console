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
