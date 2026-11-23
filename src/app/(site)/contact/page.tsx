import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, PlayCircle } from "lucide-react";
import { SITE } from "@/lib/site";
import { Eyebrow } from "../parts";
import { ContactForm } from "./contact-form";
import { ContactIntro } from "./from-link";

export const metadata: Metadata = {
  title: "Contact",
  description: "Ask about pricing, book a walkthrough, or get your fleet set up on FleetCore.",
};

/** Prebuilt: what the link asked for (?plan=, ?topic=demo) is applied in the browser (from-link.tsx). */
export default function ContactPage() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div>
        <Eyebrow>Contact</Eyebrow>
        <ContactIntro />
        <ul className="mt-10 space-y-5">
          <li className="flex gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div><p className="text-[15px] font-medium">We answer within one business day</p><p className="text-[14px] text-fg-muted">Usually the same day.</p></div>
          </li>
          {SITE.email && (
            <li className="flex gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div><p className="text-[15px] font-medium">Prefer email?</p><a href={`mailto:${SITE.email}`} className="text-[14px] text-accent-text hover:underline">{SITE.email}</a></div>
            </li>
          )}
          <li className="flex gap-3">
            <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div><p className="text-[15px] font-medium">Want to look first?</p><Link href="/demo" className="text-[14px] text-accent-text hover:underline">Open the live demo</Link></div>
          </li>
        </ul>
      </div>
      <ContactForm />
    </section>
  );
}
