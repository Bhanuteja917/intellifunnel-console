"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Building2,
  Circle,
  ClipboardCheck,
  FileText,
  Handshake,
  ImageIcon,
  ListChecks,
  Lock,
  LogOut,
  Megaphone,
  Monitor,
  Moon,
  Radio,
  ShieldCheck,
  Sun,
  User,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/** `badge` is a count shown beside the label; omit it, or pass 0, for none. */
type NavItem = { href: Route; label: string; badge?: number };

// Icons are resolved here, client-side, by href rather than accepted as a
// prop: a layout.tsx passing `nav` is a Server Component, and Lucide icons
// are functions — React server/client serialization rejects functions
// crossing that boundary ("Only plain objects can be passed to Client
// Components from Server Components").
const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/campaigns": Megaphone,
  "/client/campaigns": Megaphone,
  "/client/approvals": ClipboardCheck,
  "/client/reports": FileText,
  "/channel-types": Radio,
  "/organizations": Building2,
  "/resolution-queue": ListChecks,
  "/verification": ShieldCheck,
  "/assets": ImageIcon,
  "/consent-texts": FileText,
  "/partner/allocations": Handshake,
  "/compliance": Lock,
};

function iconFor(href: string): LucideIcon {
  return NAV_ICONS[href] ?? Circle;
}

const THEME_OPTIONS = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "system", label: "System theme", icon: Monitor },
] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export function AppSidebar({
  user,
  nav,
  title,
  subtitle,
}: {
  user: { name: string; email: string };
  nav: readonly NavItem[];
  title: string;
  subtitle: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  async function logout() {
    // A second click while the first request is still in flight would fire a
    // redundant sign-out and could navigate before the first one resolved.
    if (signingOut) return;
    setSigningOut(true);

    // signOut resolves to { data, error } rather than rejecting, so an ignored
    // result would send the reader to /sign-in still holding a valid session
    // cookie, believing they had logged out.
    const result = await authClient.signOut();

    if (result.error !== null && result.error !== undefined) {
      toast.error("Could not sign you out. Please try again.");
      setSigningOut(false);
      return;
    }

    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image blocks SVG optimization by default */}
          <img src="/logo.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-1">
            {nav.map((item) => {
              const Icon = iconFor(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  >
                    <Link href={item.href}>
                      <Icon />
                      <span>{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
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
            <div className="flex items-center justify-between gap-2 px-1.5 py-1">
              <span className="text-sm">Theme</span>
              <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    type="button"
                    size="icon-xs"
                    variant={theme === value ? "secondary" : "ghost"}
                    aria-label={label}
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <Icon />
                  </Button>
                ))}
              </div>
            </div>
            <DropdownMenuSeparator />
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
