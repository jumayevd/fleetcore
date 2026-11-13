"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Mail, MapPin, Phone } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import type { MailboxState, MailProvider } from "@/lib/mail/shared";
import { MailCompose } from "./mail-compose";

/*
 * Call, Email and Map beside a vendor's contact details. Call and the mail app go through the device (tel: / mailto:),
 * so the phone's dialer or the computer's calling app (Phone Link, FaceTime, Teams…) and default mail app answer.
 * Map opens Google Maps in a new tab of the same browser.
 */

const small = cn(buttonClass("secondary", "sm"), "h-6 px-2 text-[11px]");

/** Digits and a leading +, so "(407) 701-1677" dials. Eleven digits starting with 1 are a US number: +1… */
export function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return `tel:${!digits.startsWith("+") && digits.length === 11 && digits.startsWith("1") ? `+${digits}` : digits}`;
}

export function CallButton({ phone }: { phone: string }) {
  return <a href={telHref(phone)} className={small} title={`Call ${phone}`}><Phone />Call</a>;
}

export function MapButton({ address }: { address: string }) {
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={small} title="Open in Google Maps (new tab)"><MapPin />Map</a>;
}

/** How the trip to Google / Microsoft went (?mail=… on the way back), in words. */
const CONNECT_RESULT: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Connected. Write the email below." },
  denied: { tone: "error", text: "The permission wasn't given, so nothing was connected." },
  expired: { tone: "error", text: "That sign-in took too long or was opened in another window. Try Connect again." },
  "wrong-account": { tone: "error", text: "You switched FleetCore account while connecting. Try Connect again." },
  "no-offline": { tone: "error", text: "Connect again and accept every permission, so FleetCore can send for you." },
  unavailable: { tone: "error", text: "That mailbox isn't set up on FleetCore yet." },
  failed: { tone: "error", text: "Connecting didn't work. Try again in a moment." },
};

export function EmailButton({ email, vendorId, vendorName, mailboxes, canSend }: {
  email: string; vendorId: string; vendorName: string; mailboxes: MailboxState[];
  /** May send from inside FleetCore (fleet editors). */
  canSend: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Back from connecting a mailbox: ?compose=google (and ?mail=connected): open the window again, then tidy the URL.
  const back = params.get("compose");
  const result = params.get("mail");
  const [compose, setCompose] = useState(Boolean(canSend && (back || result)));
  const [arrived] = useState(() => ({ provider: (back ?? params.get("provider") ?? "").toUpperCase() as MailProvider, notice: result ? CONNECT_RESULT[result] ?? CONNECT_RESULT.failed : null }));
  useEffect(() => {
    if (back || result) router.replace(pathname, { scroll: false });
  }, [back, result, pathname, router]);
  // The menu is drawn over the page (a portal in <body>, placed under the button): the contact value it sits in cuts
  // off whatever overflows it, so a menu inside it would open invisibly. It follows the button when the page scrolls.
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  const toggle = () => {
    if (open) { setOpen(false); return; }
    place();
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => Boolean(t && (ref.current?.contains(t as Node) || menu.current?.contains(t as Node)));
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const follow = () => {
      const r = button.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open]);
  const to = encodeURIComponent(email);
  const options = [
    { label: "Mail app on this device", hint: "Outlook, Mail or whatever opens email here", href: `mailto:${email}`, external: false },
    { label: "Gmail", hint: "In a new tab", href: `https://mail.google.com/mail/?view=cm&fs=1&to=${to}`, external: true },
    { label: "Outlook on the web", hint: "In a new tab", href: `https://outlook.office.com/mail/deeplink/compose?to=${to}`, external: true },
  ];
  return (
    <div ref={ref} className="relative inline-block">
      <button ref={button} type="button" className={small} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <Mail />Email<ChevronDown />
      </button>
      {open && at && createPortal(
        <div ref={menu} role="menu" style={{ top: at.top, right: at.right }}
          className="pop-in fixed z-[80] w-60 max-w-[calc(100vw-16px)] rounded-[10px] border border-line bg-overlay p-1 shadow-float">
          {options.map((o) => (
            <a key={o.label} role="menuitem" href={o.href} onClick={() => setOpen(false)}
              {...(o.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="block rounded-[7px] px-2.5 py-1.5 hover:bg-raised">
              <span className="block text-[13px] font-medium text-fg">{o.label}</span>
              <span className="block text-[11px] text-fg-subtle">{o.hint}</span>
            </a>
          ))}
          {canSend && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setCompose(true); }}
              className="block w-full rounded-[7px] border-t border-line px-2.5 py-1.5 text-left hover:bg-raised">
              <span className="block text-[13px] font-medium text-fg">Write in FleetCore</span>
              <span className="block text-[11px] text-fg-subtle">With photos and files, sent from your Gmail or Outlook</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      {canSend && (
        <MailCompose open={compose} onClose={() => setCompose(false)} to={email} vendorId={vendorId} vendorName={vendorName} mailboxes={mailboxes}
          returnTo={pathname} initialProvider={arrived.provider || null} notice={arrived.notice} />
      )}
    </div>
  );
}
