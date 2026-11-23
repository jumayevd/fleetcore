import type { Metadata } from "next";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/components/ui";
import { FAQ, FLAT_TRUCKS, PLANS } from "@/lib/site";
import { CtaBand, SectionHead, bigButton } from "../parts";
import { PriceCalculator } from "./calculator";
import { ServicePrices } from "../service-prices";

export const metadata: Metadata = {
  title: "Pricing",
  description: `FleetCore pricing by fleet size: one flat price up to ${FLAT_TRUCKS} trucks, then per truck. With or without the AI fleet assistant.`,
};

export default function PricingPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_50%_at_50%_0%,var(--accent-soft),transparent_70%)]" />
        <div className="relative mx-auto max-w-5xl px-5 pb-12 pt-16 sm:pt-20">
          <SectionHead eyebrow="Pricing" title="Priced by fleet size. Everything included." center>
            One flat monthly price up to {FLAT_TRUCKS} trucks, then a simple price per truck. Trailers, team members,
            setup help and loading your data are always included.
          </SectionHead>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {PLANS.map((p) => (
              <div key={p.id} className={cn("relative flex flex-col rounded-2xl border bg-surface p-7 sm:p-8",
                p.popular ? "border-accent shadow-float ring-4 ring-accent/10" : "border-line")}>
                {p.popular && (
                  <span className="absolute -top-3 left-7 inline-flex items-center gap-1 rounded-full bg-linear-to-r from-accent to-progress px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-on-accent">
                    <Sparkles className="h-3 w-3" />With AI
                  </span>
                )}
                <h2 className="text-[20px] font-semibold">{p.name}</h2>
                <p className="mt-2 text-[14px] leading-6 text-fg-muted">{p.blurb}</p>

                <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-line">
                  <div className="p-4">
                    <p className="text-[12px] font-medium text-fg-subtle">1–{FLAT_TRUCKS} trucks</p>
                    <p className="mt-1.5 text-[36px] font-semibold leading-none tracking-tight">${p.flat}</p>
                    <p className="mt-1 text-[12px] text-fg-muted">per month, flat</p>
                  </div>
                  <div className="border-l border-line bg-raised p-4">
                    <p className="text-[12px] font-medium text-fg-subtle">{FLAT_TRUCKS + 1}+ trucks</p>
                    <p className="mt-1.5 text-[36px] font-semibold leading-none tracking-tight">${p.perTruck}</p>
                    <p className="mt-1 text-[12px] text-fg-muted">per truck, per month</p>
                  </div>
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{f}</li>
                  ))}
                </ul>
                <Link href={`/contact?plan=${p.id}`} className={cn(bigButton(p.popular ? "accent" : "secondary"), "mt-8 w-full")}>Get started with {p.name}</Link>
              </div>
            ))}
          </div>

          <div className="mt-8"><PriceCalculator /></div>
          <p className="mt-6 text-center text-[13px] text-fg-subtle">
            Prices in US dollars, billed monthly. Not sure yet? <Link href="/demo" className="font-medium text-accent-text hover:underline">Watch the live demo</Link> first.
          </p>
        </div>
      </section>

      <section id="service" className="mx-auto max-w-5xl scroll-mt-20 px-5 pt-8">
        <SectionHead eyebrow="Fleet service" title="Prefer us to run the maintenance?" center>
          Our team handles oil changes, DOT inspections, weekly PTI control, breakdowns and warranty claims for you.{" "}
          <Link href="/fleet-service" className="font-medium text-accent-text hover:underline">See what&apos;s included</Link>.
        </SectionHead>
        <ServicePrices className="mt-10" />
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="text-center text-[26px] font-semibold tracking-[-0.02em]">Questions</h2>
        <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-6 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                {q}<span aria-hidden className="text-[20px] leading-none text-fg-subtle transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-[14px] leading-6 text-fg-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <CtaBand />
    </>
  );
}
