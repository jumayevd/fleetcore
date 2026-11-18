import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { isDemoEnabled } from "@/lib/demo";
import { openDemo } from "@/app/actions/site";
import { Eyebrow, Shot, bigButton } from "../parts";
import { DemoButton } from "./demo-button";

export const metadata: Metadata = {
  title: "Live demo",
  description: "Open a working FleetCore fleet in your browser: trucks, drivers, repairs, defects and papers. No sign-up.",
};

const TRY = [
  "Open Today and clear an overdue oil change",
  "Book a repair for a truck held out of service",
  "Review a driver's weekly walk-around",
  "Find which papers expire this month",
  "See what each truck cost you in Reports",
];

export default function DemoPage() {
  const enabled = isDemoEnabled();
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_55%_at_80%_20%,var(--accent-soft),transparent_70%)]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <Eyebrow>Live demo</Eyebrow>
          <h1 className="mt-4 text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">Drive a real fleet in FleetCore.</h1>
          <p className="mt-5 text-[17px] leading-8 text-fg-muted">
            <b className="font-semibold text-fg">Demo Freight Co.</b> runs 16 trucks and 14 trailers out of Chicago, with
            drivers, shops, repairs, defects and papers. You work as their fleet specialist.
          </p>
          <ul className="mt-6 space-y-2.5">
            {TRY.map((t) => <li key={t} className="flex gap-2.5 text-[15px]"><Check className="mt-1 h-4 w-4 shrink-0 text-accent" />{t}</li>)}
          </ul>
          {enabled ? (
            <form action={openDemo} className="mt-9">
              <DemoButton />
              <p className="mt-4 flex items-center gap-2 text-[13px] text-fg-subtle">
                <RotateCcw className="h-3.5 w-3.5" />Change anything you like: the demo goes back to how it was every night.
              </p>
            </form>
          ) : (
            <div className="mt-9">
              <Link href="/contact?topic=demo" className={bigButton()}>Book a live walkthrough<ArrowRight /></Link>
              <p className="mt-4 text-[13px] text-fg-subtle">The self-serve demo is being set up. We&apos;ll show you FleetCore on a call in the meantime.</p>
            </div>
          )}
        </div>
        <Shot src="/site/workorders.webp" alt="Repairs in the demo fleet" priority />
      </div>
    </section>
  );
}
