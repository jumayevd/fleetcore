import { Skeleton } from "@/components/ui";

/** Skeleton that mirrors the Today layout so the page does not jump when data arrives. */
export default function Loading() {
  const card = "rounded-lg border border-line bg-surface shadow-card";
  return (
    <div aria-busy="true" aria-label="Loading Today" className="skeleton-delay">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-3 w-56 max-w-[60vw]" />
        </div>
        <Skeleton className="h-8 w-64 rounded-md" />
      </div>
      {/* Eight tiles, four to a row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`${card} space-y-3 px-4 py-3.5`}>
            <Skeleton className="h-8 w-8 rounded-[9px]" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      {/* Left: decisions over the map · right: shop, spend, coming up */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="grid gap-4 xl:col-span-2">
          <div className={`${card} space-y-3 p-4`}>
            <Skeleton className="h-7 w-80 max-w-full rounded-[10px]" />
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
          <div className={`${card} p-1.5`}><Skeleton className="h-[300px] w-full" /></div>
        </div>
        <div className="grid gap-4">
          {[5, 4, 5].map((n, i) => (
            <div key={i} className={`${card} space-y-3 p-4`}>
              {Array.from({ length: n }).map((__, j) => <Skeleton key={j} className="h-7 w-full" />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
