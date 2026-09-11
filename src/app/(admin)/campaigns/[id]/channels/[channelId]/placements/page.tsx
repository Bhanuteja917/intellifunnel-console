import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function PlacementsPage({
  params,
}: {
  params: Promise<{ id: string; channelId: string }>;
}) {
  const { id, channelId } = await params;
  redirect(`/campaigns/${id}/channels/${channelId}?tab=placements` as Route);
}
