import Link from "next/link";
import { cn } from "@/components/ui";
import { SERVICE } from "@/lib/site";
import { bigButton } from "./parts";

/** The fleet service price list: per truck a month by fleet size, or per case. On /fleet-service and /pricing. */
export function ServicePrices({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-5 md:grid-cols-[1.6fr_1fr]", className)}>
      <div className="rounded-2xl border border-line bg-surface p-7 sm:p-8">
        <h3 className="text-[20px] font-semibold">By fleet size</h3>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">Per unit, per month. Everything in the service list is included.</p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-[14px]">
            <thead className="bg-raised text-[12px] font-medium text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Fleet</th>
                <th scope="col" className="px-4 py-3 font-medium">Bobtail</th>
                <th scope="col" className="px-4 py-3 font-medium">Truck and trailer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SERVICE.tiers.map((t) => (
                <tr key={t.trucks}>
                  <th scope="row" className="px-4 py-4 font-medium">{t.trucks}</th>
                  {t.bobtail == null ? (
                    <td colSpan={2} className="px-4 py-4 text-fg-muted">Price is negotiable</td>
                  ) : (
                    <>
                      <td className="px-4 py-4"><span className="text-[22px] font-semibold tracking-tight">${t.bobtail}</span><span className="text-fg-subtle"> / unit</span></td>
                      <td className="px-4 py-4"><span className="text-[22px] font-semibold tracking-tight">${t.withTrailer}</span><span className="text-fg-subtle"> / unit</span></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-col rounded-2xl border border-line bg-surface p-7 sm:p-8">
        <h3 className="text-[20px] font-semibold">Per case</h3>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">Only need help now and then? Pay for each issue we handle.</p>
        <p className="mt-6 text-[36px] font-semibold leading-none tracking-tight">${SERVICE.perCase.from}–${SERVICE.perCase.to}</p>
        <p className="mt-1.5 text-[12px] text-fg-muted">per case, depending on the case</p>
        <Link href={`/contact?plan=${SERVICE.id}`} className={cn(bigButton("accent"), "mt-8 w-full")}>Get a quote</Link>
      </div>
    </div>
  );
}
