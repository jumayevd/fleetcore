import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Clock, LineChart, ShieldCheck } from "lucide-react";
import { SERVICE } from "@/lib/site";
import { CtaBand, Eyebrow, SectionHead, bigButton } from "../parts";
import { ServicePrices } from "../service-prices";

export const metadata: Metadata = {
  title: "Fleet service",
  description: "FleetCore outsourced fleet service: oil changes, DOT inspections, weekly PTI control, breakdowns, warranty claims and cost reports for your trucks and trailers.",
};

const POINTS = [
  { icon: Clock, title: "Around the clock", text: "Roadside breakdowns, shops, dealers and towing handled day and night, so your trucks get back on the road." },
  { icon: ShieldCheck, title: "Safe and compliant", text: "Oil changes, DOT inspections and weekly PTI control on schedule, for every truck and trailer." },
  { icon: LineChart, title: "Every cost in view", text: "Each unit's maintenance in FleetCore, with daily, weekly and monthly cost tracking, reports and full service history." },
];

/** The outsourced fleet service: what we do for a fleet, and what it costs. */
export default function FleetServicePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_50%_at_50%_0%,var(--accent-soft),transparent_70%)]" />
        <div className="relative mx-auto max-w-5xl px-5 pb-12 pt-16 text-center sm:pt-20">
          <Eyebrow>Fleet service</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[50px]">
            We keep your fleet on the road, around the clock.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-[17px] leading-8 text-fg-muted">
            FleetCore Outsource Service keeps your trucks and trailers safe, compliant and on the road. Whatever the issue, from a
            roadside breakdown to a warranty dispute, we find the best solution for both your drivers and your company.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/contact?plan=${SERVICE.id}`} className={bigButton()}>Get a quote<ArrowRight /></Link>
            <a href="#prices" className={bigButton("secondary")}>See service prices</a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text"><Icon className="h-5 w-5" /></span>
              <h2 className="mt-4 text-[17px] font-semibold">{title}</h2>
              <p className="mt-2 text-[14px] leading-6 text-fg-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-12">
        <SectionHead eyebrow="What we provide" title="We don't just fix problems." center>
          Our team handles the work, and FleetCore gives you a clear view of each unit&apos;s maintenance, costs and service history.
        </SectionHead>
        <ul className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-2">
          {SERVICE.provides.map((p) => (
            <li key={p} className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-[15px]">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{p}
            </li>
          ))}
        </ul>
      </section>

      <section id="prices" className="mx-auto max-w-5xl scroll-mt-20 px-5 py-12">
        <SectionHead eyebrow="Service prices" title="Per truck, or per case." center>
          A monthly price per truck by fleet size, or pay only for the cases we handle.
        </SectionHead>
        <ServicePrices className="mt-10" />
        <p className="mt-6 text-center text-[13px] text-fg-subtle">
          Prices in US dollars. Questions about what fits your fleet? <Link href={`/contact?plan=${SERVICE.id}`} className="font-medium text-accent-text hover:underline">Write to us</Link>.
        </p>
      </section>

      <CtaBand />
    </>
  );
}
