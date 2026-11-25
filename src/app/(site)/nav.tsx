"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";

const LINKS = [["/#features", "Product"], ["/fleet-service", "Fleet service"], ["/pricing", "Pricing"], ["/demo", "Product tour"], ["/contact", "Contact"]] as const;

/** Site header links and buttons; a menu on phones. Log in takes people already signed in straight to their fleet. */
export function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const on = (href: string) => !href.includes("#") && path === href;
  const account = (
    <>
      <Link href="/login" onClick={() => setOpen(false)} className={buttonClass("ghost")}>Log in</Link>
      <Link href="/signup" onClick={() => setOpen(false)} className={buttonClass("secondary")}>Sign up</Link>
    </>
  );
  return (
    <>
      <nav aria-label="Site" className="hidden flex-1 items-center gap-1 md:flex">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={on(href) ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-[14px] transition-colors", on(href) ? "font-medium text-fg" : "text-fg-muted hover:text-fg")}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto hidden items-center gap-2 md:flex">
        {account}
        <Link href="/contact?topic=demo" className={buttonClass("accent")}>Book a demo</Link>
      </div>
      <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg md:hidden">
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-16 border-b border-line bg-canvas px-5 pb-5 pt-2 shadow-lift md:hidden">
          <nav aria-label="Site" className="flex flex-col">
            {LINKS.map(([href, label]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)} className="border-b border-line py-3 text-[15px] text-fg">{label}</Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-wrap gap-2">
            {account}
            <Link href="/contact?topic=demo" onClick={() => setOpen(false)} className={buttonClass("accent")}>Book a demo</Link>
          </div>
        </div>
      )}
    </>
  );
}
