import type { ReactNode } from "react";
import { Truck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Signal, SignalGrid } from "./signal";

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-mark bg-linear-to-br from-white/25 to-white/0 text-on-mark shadow-card">
        <Truck className="h-4 w-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">FleetOps</span>
      <span className="eyebrow mt-px">Fleet</span>
    </div>
  );
}

/** The two-panel frame shared by sign in, add account, sign up and invitations. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <main className="relative grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle showLabel className="h-8 border border-line bg-surface px-2" />
      </div>

      {/* Product statement */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-10 lg:flex xl:p-14">
        <SignalGrid />
        {/* A soft wash of the accent behind the headline: colour without a picture. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_18%_42%,var(--accent-soft),transparent_70%)]" />
        <div className="relative z-10"><Wordmark /></div>
        <div className="relative z-10 max-w-xl">
          <p className="eyebrow mb-3">Trucks · Trailers · Maintenance · Compliance</p>
          {/* Marketing line, not the page heading: this panel is hidden below lg. */}
          <p className="text-[32px] font-semibold leading-[1.15] tracking-tight text-fg xl:text-[36px]">
            Every truck and every paper,{" "}
            <span className="bg-linear-to-r from-accent to-progress bg-clip-text text-transparent">for every company you run.</span>
          </p>
          <p className="mt-4 max-w-md text-[14px] leading-6 text-fg-muted">
            Built for fleet specialists: PM by odometer, expiring paperwork, shop time and costs. Each company you work
            for keeps its own data in its own workspace, and you switch between them in one click.
          </p>
          <Signal />
        </div>
        <p className="relative z-10 text-[11px] text-fg-subtle">© {year} FleetOps · Day and night themes · Keyboard first</p>
      </section>

      <section className="flex items-center justify-center px-5 py-14 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 lg:hidden"><Wordmark /></div>
          {children}
        </div>
      </section>
    </main>
  );
}

export function AuthCard({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-lift sm:p-7">
      <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
      {subtitle && <div className="mt-1 text-[13px] text-fg-subtle">{subtitle}</div>}
      {children}
    </div>
  );
}
