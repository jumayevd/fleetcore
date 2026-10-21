import { Skeleton } from "@/components/ui";

/** Skeleton that mirrors the Overview layout so the page does not jump when data arrives. */
export default function Loading() {
  const card = "rounded-lg border border-line bg-surface shadow-card";
  return (
    <div aria-busy="true" aria-label="Loading overview" className="skeleton-delay">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-3 w-80 max-w-[60vw]" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      <div className={`${card} grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-3 xl:grid-cols-6`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-surface px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className={`${card} space-y-4 p-4 xl:col-span-2`}>
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
        <div className={`${card} space-y-4 p-4`}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className={`${card} p-1.5 xl:col-span-2`}><Skeleton className="h-[350px] w-full" /></div>
        <div className="grid content-start gap-4">
          <div className={`${card} h-[190px] p-4`}><Skeleton className="h-full w-full" /></div>
          <div className={`${card} h-[170px] p-4`}><Skeleton className="h-full w-full" /></div>
        </div>
      </div>
    </div>
  );
}
