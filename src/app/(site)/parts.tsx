import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";

/** A big call-to-action button (the app's buttons are sized for dense screens). */
export const bigButton = (variant: "accent" | "secondary" = "accent") => cn(buttonClass(variant), "h-11 rounded-[10px] px-5 text-[15px]");

/** A product screen in a quiet window frame. Screens are 1600×1000 night-theme captures (public/site). */
export function Shot({ src, alt, priority, className }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-[#0b0d12] shadow-float", className)}>
      <div aria-hidden className="flex h-7 items-center gap-1.5 border-b border-white/8 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      </div>
      <Image src={src} alt={alt} width={1600} height={1000} priority={priority} sizes="(min-width: 1024px) 720px, 100vw" className="block h-auto w-full" />
    </div>
  );
}

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
            Open a real fleet in FleetCore right now. No sign-up, no card: click around, add a repair, close a defect.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/demo" className={bigButton()}>Open the live demo<ArrowRight /></Link>
            <Link href="/contact" className={bigButton("secondary")}>Talk to us</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
