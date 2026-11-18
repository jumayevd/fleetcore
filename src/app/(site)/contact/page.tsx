import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, PlayCircle } from "lucide-react";
import { PLANS, SITE } from "@/lib/site";
import { Eyebrow } from "../parts";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Ask about pricing, book a walkthrough, or get your fleet set up on FleetCore.",
};

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const sp = await searchParams;
  const planId = typeof sp.plan === "string" ? sp.plan : undefined;
  const plan = PLANS.find((p) => p.id === planId);
  const demo = sp.topic === "demo";
  const intro = plan
    ? `You picked ${plan.name} (${plan.trucks.toLowerCase()}). Tell us a little about your fleet and we'll get you set up.`
    : demo
      ? "Tell us when suits you and we'll show you FleetCore on your own kind of fleet."
      : "Pricing, a walkthrough, moving your data in, or just a question: write to us.";

  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div>
        <Eyebrow>Contact</Eyebrow>
        <h1 className="mt-4 text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
          {demo ? "Book a walkthrough." : "Let's get your fleet on FleetCore."}
        </h1>
        <p className="mt-5 text-[17px] leading-8 text-fg-muted">{intro}</p>
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
      <ContactForm plans={PLANS.map((p) => ({ id: p.id, name: p.name }))} plan={plan?.id} />
    </section>
  );
}
