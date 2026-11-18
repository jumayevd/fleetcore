import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/components/ui";
import { FAQ, PLANS } from "@/lib/site";
import { CtaBand, SectionHead, bigButton } from "../parts";

export const metadata: Metadata = {
  title: "Pricing",
  description: "FleetCore plans for small fleets, growing carriers and fleet managers running several companies.",
};

export default function PricingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-20">
        <SectionHead eyebrow="Pricing" title="One price for the whole fleet team." center>
          Pick the plan that fits your fleet today. Move up when you grow. Every plan includes setup help and your data
          loaded for you.
        </SectionHead>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.id} className={cn("relative flex flex-col rounded-2xl border bg-surface p-7", p.popular ? "border-accent shadow-float" : "border-line")}>
              {p.popular && (
                <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-on-accent">Most popular</span>
              )}
              <h2 className="text-[18px] font-semibold">{p.name}</h2>
              <p className="mt-1 text-[13px] text-fg-subtle">{p.trucks}</p>
              <p className="mt-6 flex h-11 items-end gap-1.5">
                {p.price != null
                  ? <><span className="text-[44px] font-semibold leading-none tracking-tight">${p.price}</span><span className="text-[14px] text-fg-muted">/ month</span></>
                  : <span className="text-[34px] font-semibold leading-none tracking-tight">Let&apos;s talk</span>}
              </p>
              <p className="mt-4 text-[14px] leading-6 text-fg-muted">{p.blurb}</p>
              <ul className="mt-6 flex-1 space-y-3 border-t border-line pt-6">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[14px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{f}</li>
                ))}
              </ul>
              <Link href={`/contact?plan=${p.id}`} className={cn(bigButton(p.popular ? "accent" : "secondary"), "mt-8 w-full")}>
                {p.price != null ? `Start with ${p.name}` : "Contact us"}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[13px] text-fg-subtle">Prices in US dollars, billed monthly. Not sure which fits? <Link href="/demo" className="font-medium text-accent-text hover:underline">Try the live demo</Link> first.</p>
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
