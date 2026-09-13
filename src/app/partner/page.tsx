import { redirect } from "next/navigation";

// Real portal gating happens in allocations/page.tsx (assertPortal, per the
// doc comment on assertPortal in src/lib/auth/permissions.ts) — this page is
// just a fixed redirect to the one page the portal currently has.
export default function PartnerIndexPage() {
  redirect("/partner/allocations");
}
