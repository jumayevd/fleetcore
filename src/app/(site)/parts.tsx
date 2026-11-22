import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";

/** A big call-to-action button (the app's buttons are sized for dense screens). */
export const bigButton = (variant: "accent" | "secondary" = "accent") => cn(buttonClass(variant), "h-11 rounded-[10px] px-5 text-[15px]");

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12px] font-semibold uppercase tracking-[0.12em] text-accent-text", className)}>{children}</p>;
}

export function SectionHead({ eyebrow, title, children, center }: { eyebrow?: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <h2 className="text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[38px]">{title}</h2>
      {children && <p className="mt-4 text-pretty text-[16px] leading-7 text-fg-muted">{children}</p>}
    </div>
  );
}

/** The closing band on every page: open the demo or talk to us. */
export function CtaBand() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20 pt-4">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-14 text-center sm:px-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,var(--accent-soft),transparent_70%)]" />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-balance text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[36px]">
            See your next missed oil change before it happens.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-7 text-fg-muted">
            Watch the one-minute tour, then open a real fleet and click around. No sign-up, no card.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/demo" className={bigButton()}>Open the live demo<ArrowRight /></Link>
            <Link href="/pricing" className={bigButton("secondary")}>See pricing</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
