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
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      {/* Six number tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${card} space-y-3 px-4 py-3.5`}>
            <Skeleton className="h-8 w-8 rounded-[9px]" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      {/* Left: today in the shop over the live map · right: needs attention over coming up */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="grid gap-4 xl:col-span-2">
          <div className={`${card} space-y-3 p-4`}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
          <div className={`${card} p-1.5`}><Skeleton className="h-[350px] w-full" /></div>
        </div>
        <div className="order-first grid gap-4 xl:order-none">
          <div className={`${card} space-y-3 p-4`}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
          <div className={`${card} space-y-3 p-4`}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        </div>
      </div>
      {/* Costs */}
      <div className={`${card} mt-4 grid gap-6 p-4 lg:grid-cols-3`}>
        <Skeleton className="h-[220px] w-full lg:col-span-2" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      </div>
    </div>
  );
}
