import type { Metadata } from "next";
import { Check, MousePointerClick, RotateCcw } from "lucide-react";
import { isDemoEnabled } from "@/lib/demo";
import { openDemo } from "@/app/actions/site";
import { Eyebrow } from "../parts";
import { Tour } from "../tour";
import { DemoButton } from "./demo-button";

export const metadata: Metadata = {
  title: "Live demo",
  description: "Watch FleetCore run a real-looking fleet: today's list, oil changes, repairs, walk-arounds, the live map, reports and the AI assistant. No sign-up.",
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
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_45%_at_50%_0%,var(--accent-soft),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-14 sm:pt-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Live demo</Eyebrow>
            <h1 className="mt-4 text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[50px]">FleetCore in one minute.</h1>
            <p className="mt-4 text-[17px] leading-8 text-fg-muted">
              The tour plays by itself. Pick a chapter to jump to it, or hover to hold it.
            </p>
          </div>
          <Tour className="mt-10" />
        </div>
      </section>

      {enabled && (
        <section className="mx-auto max-w-6xl px-5 pb-20 pt-6">
          <div className="grid items-center gap-8 rounded-2xl border border-line bg-surface p-7 sm:p-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
            <div>
              <p className="flex items-center gap-2 text-[13px] font-semibold text-accent-text"><MousePointerClick className="h-4 w-4" />Now drive it yourself</p>
              <h2 className="mt-2 text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em]">Open the demo fleet and click around.</h2>
              <p className="mt-3 text-[15px] leading-7 text-fg-muted">
                <b className="font-semibold text-fg">Demo Freight Co.</b> runs 16 trucks and 14 trailers out of Chicago. You work as
                their fleet specialist. No sign-up, no card.
              </p>
              <form action={openDemo} className="mt-6">
                <DemoButton />
                <p className="mt-3 flex items-center gap-2 text-[13px] text-fg-subtle"><RotateCcw className="h-3.5 w-3.5" />Change anything you like: it goes back to how it was every night.</p>
              </form>
            </div>
            <ul className="space-y-3 rounded-xl bg-raised p-5">
              {TRY.map((t) => <li key={t} className="flex gap-2.5 text-[14px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{t}</li>)}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
