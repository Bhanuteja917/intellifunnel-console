import { Skeleton } from "@/components/ui/skeleton";

/**
 * A Suspense boundary for every admin page. Beyond the loading state itself,
 * it is what lets `error.tsx` render on a first request that throws: without a
 * boundary to stream inside, an error in the page's own server render escapes
 * to Next's global error document instead of the segment's error UI.
 */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
