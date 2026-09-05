import { redirect } from "next/navigation";

// The layout above this segment already gates on actor.portal, so no auth
// logic is needed here — just a fixed entry point to the one page the
// portal currently has.
export default function PartnerIndexPage() {
  redirect("/partner/allocations");
}
