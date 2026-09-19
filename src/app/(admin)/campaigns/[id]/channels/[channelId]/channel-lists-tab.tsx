import { db } from "@/lib/db";
import { TargetAccountListCard } from "./target-account-list-card";
import { SuppressionListCard } from "./suppression-list-card";

type Props = {
  campaignId: string;
  channelId: string;
  editable: boolean;
  hasTalStep: boolean;
  hasSuppressionStep: boolean;
};

export async function ChannelListsTab({ campaignId, channelId, editable, hasTalStep, hasSuppressionStep }: Props) {
  const [talLink, suppressionLink] = await Promise.all([
    hasTalStep
      ? db.channelList.findFirst({ where: { campaignChannelId: channelId, list: { type: "targetAccounts" } }, include: { list: true } })
      : Promise.resolve(null),
    hasSuppressionStep
      ? db.channelList.findFirst({ where: { campaignChannelId: channelId, list: { type: "suppression" } }, include: { list: true } })
      : Promise.resolve(null),
  ]);

  const [talEntries, talCount, suppressionEntries, suppressionCount] = await Promise.all([
    talLink === null
      ? Promise.resolve([])
      : db.listEntry.findMany({ where: { listId: talLink.listId }, orderBy: { createdAt: "asc" }, take: 50 }),
    talLink === null ? Promise.resolve(0) : db.listEntry.count({ where: { listId: talLink.listId } }),
    suppressionLink === null
      ? Promise.resolve([])
      : db.listEntry.findMany({ where: { listId: suppressionLink.listId }, orderBy: { createdAt: "asc" }, take: 50 }),
    suppressionLink === null ? Promise.resolve(0) : db.listEntry.count({ where: { listId: suppressionLink.listId } }),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {hasTalStep && (
        <TargetAccountListCard
          campaignId={campaignId}
          channelId={channelId}
          listName={talLink?.list.name ?? null}
          rowCount={talCount}
          entries={talEntries.map((e) => ({ id: e.id, accountName: e.accountName, accountRawDomain: e.accountRawDomain }))}
          editable={editable}
          downloadHref={`/api/campaigns/${campaignId}/channels/${channelId}/target-accounts/export`}
        />
      )}
      {hasSuppressionStep && (
        <SuppressionListCard
          campaignId={campaignId}
          channelId={channelId}
          listName={suppressionLink?.list.name ?? null}
          rowCount={suppressionCount}
          entries={suppressionEntries.map((e) => ({ id: e.id, accountName: e.accountName, accountRawDomain: e.accountRawDomain }))}
          editable={editable}
          downloadHref={`/api/campaigns/${campaignId}/channels/${channelId}/suppression-list/export`}
        />
      )}
    </div>
  );
}
