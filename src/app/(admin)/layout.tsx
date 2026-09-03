import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/channel-types", label: "Channel types" },
  { href: "/organizations", label: "Organisations" },
  { href: "/resolution-queue", label: "Resolution queue" },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild>
                  <Link href={item.href}>{item.label}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
