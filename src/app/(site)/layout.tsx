import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionContext } from "@/lib/session";
import { HOME } from "@/lib/permissions";
import { SITE } from "@/lib/site";
import { SiteNav } from "./nav";

/** The public site: product, pricing, live demo and contact. Inter throughout, whatever font the app is set to. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const { accounts, active } = await getSessionContext();
  const signedIn = accounts.length > 0;
  const year = new Date().getFullYear();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-fg" style={{ fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/" aria-label="FleetCore home" className="shrink-0"><Wordmark className="h-[26px]" /></Link>
          <SiteNav signedIn={signedIn} appHref={active ? HOME : "/select"} />
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Wordmark className="h-6" />
            <p className="mt-3 max-w-xs text-[13px] leading-6 text-fg-muted">
              Maintenance, paperwork and compliance for trucking fleets, on one screen.
            </p>
          </div>
          <FooterCol title="Product" links={[["/#features", "Features"], ["/pricing", "Pricing"], ["/demo", "Live demo"]]} />
          <FooterCol title="Company" links={[["/contact", "Contact"], ...(SITE.email ? [[`mailto:${SITE.email}`, SITE.email] as [string, string]] : [])]} />
          <FooterCol title="Account" links={signedIn ? [[active ? HOME : "/select", "Open FleetCore"]] : [["/login", "Sign in"]]} />
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 text-[12px] text-fg-subtle">
            <p>© {year} {SITE.name} · by <span className="font-medium text-fg-muted">{SITE.maker}</span>. All rights reserved.</p>
            <ThemeToggle showLabel className="h-8 border border-line bg-canvas px-2" />
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [href: string, label: string][] }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([href, label]) => (
          <li key={href}><Link href={href} className="text-[13px] text-fg-muted hover:text-fg">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}
