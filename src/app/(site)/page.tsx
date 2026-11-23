import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Bell, Building2, CalendarClock, ClipboardCheck, Droplet, FileWarning, MapPin, MessageSquareText, Receipt,
  ShieldAlert, Sparkles, Store, Truck, Users, Wrench,
} from "lucide-react";
import { cn } from "@/components/ui";
import { CtaBand, Eyebrow, SectionHead, bigButton } from "./parts";
import { ProductVideo } from "./video";
import { MockStage } from "./mock/stage";
import { Reveal } from "./reveal";
import { AssistantScene, InspectionsScene, MapScene, OilScene, RepairsScene, ReportsScene, TodayScene } from "./mock/scenes";

export const metadata: Metadata = {
  title: { absolute: "FleetCore: fleet maintenance and compliance for trucking companies" },
  description: "Oil changes by odometer, repairs and shop time, pre-trip walk-arounds, expiring papers and roadside inspections for every truck and trailer, on one screen. Try the live demo.",
};

const PAINS = [
  { icon: Droplet, title: "Oil changes slip by", text: "Mileage lives in the ELD, the due date in someone's head. The truck runs 3,000 miles over and nobody notices until the engine does." },
  { icon: FileWarning, title: "Papers expire quietly", text: "A registration, an annual inspection or a medical card runs out, and you find out at a weigh station with the load on." },
  { icon: Wrench, title: "Trucks sit in the shop", text: "The shop promised Tuesday. It's Friday. Nobody chased it, because the repair lives in a text thread." },
  { icon: MessageSquareText, title: "Defects get lost in chat", text: "A driver reports a cracked hose in the group chat. It scrolls away. Two weeks later it's a road call." },
];

const FEATURES = [
  {
    eyebrow: "Today", title: "One list of what needs a decision today",
    text: "Every morning FleetCore puts overdue oil changes, expired papers, open defects, late shops and missing walk-arounds in one list, with the next action on each row. Clear the list and your fleet is in order.",
    points: ["Overdue first, then due today, then this week", "One click to book, renew, chase or assign", "Filters by oil, shop, documents, PTI, drivers"],
    scene: TodayScene,
  },
  {
    eyebrow: "Preventive maintenance", title: "Oil changes by odometer, not by memory",
    text: "Set the interval per truck type. FleetCore reads the odometer from your ELD and shows how many miles each truck has used, which are over, and which shop did the last service.",
    points: ["Intervals by truck type or per truck", "Odometer, engine hours and fuel from TrackPro", "Book the service straight from the overdue row"],
    scene: OilScene,
  },
  {
    eyebrow: "Repairs", title: "Every repair, from booked to back on the road",
    text: "Open a repair in seconds: truck, shop, what's wrong. Track it through booked, in the shop, waiting for parts and done, with the promised date, downtime and the invoice lines.",
    points: ["Downtime and promised dates, late shops flagged", "Invoice lines by system: brakes, engine, tires, labor", "Cost per truck, per mile and per kind of truck"],
    scene: RepairsScene,
  },
  {
    eyebrow: "Inspections", title: "Weekly walk-arounds and defects with an owner",
    text: "Drivers send a walk-around every week. Your team reviews it, rates it, and turns anything wrong into a defect with an owner and a due date, out of service if it has to be.",
    points: ["Pre-trip board: who sent, who's missing", "Defects with owner, due date and repair link", "Roadside inspections and DOT corrections tracked"],
    scene: InspectionsScene,
  },
  {
    eyebrow: "Live fleet", title: "Where every truck is, and how much fuel it has",
    text: "Connect your ELD and FleetCore keeps each truck's position, odometer and fuel level current. The map shows the fleet; the truck page shows the history.",
    points: ["Live map with last position and speed", "Odometer and engine hours update on their own", "Works with TrackPro today"],
    scene: MapScene,
  },
  {
    eyebrow: "Reports", title: "Know what each truck costs you",
    text: "Maintenance spend by month, by truck, by shop and by kind of repair. See which trucks eat the budget and which shops you use the most, and export it for the accountant.",
    points: ["Spend this month against last month", "Cost per mile and per truck type", "Export to CSV for Excel"],
    scene: ReportsScene,
  },
  {
    eyebrow: "AI assistant", title: "Ask your fleet a question, get the answer",
    text: "“Which trucks are due for oil this week?” “What did 2207 cost us this year?” The assistant answers from your own fleet data in seconds, and can book, remind or assign straight from the answer.",
    points: ["Plain-language questions about trucks, repairs, papers and costs", "Answers from your data, not the internet", "Included in the Standard + AI plan"],
    scene: AssistantScene,
  },
];

const MORE = [
  { icon: Truck, title: "Trucks and trailers", text: "Units, VINs, plates, ownership, leases and status." },
  { icon: Users, title: "Drivers and teams", text: "Licences, medical cards, phones, dispatchers, team drivers." },
  { icon: CalendarClock, title: "Expiry reminders", text: "Registration, insurance, annual DOT, IFTA, licences." },
  { icon: Store, title: "Vendors", text: "Shops, dealers, tire and mobile service, with contacts." },
  { icon: Receipt, title: "Invoices and documents", text: "Every paper on file, attached to the truck or repair." },
  { icon: ShieldAlert, title: "Roadside inspections", text: "Violations, corrections and deadlines per report." },
  { icon: Building2, title: "Several companies", text: "Run many fleets with one sign-in, each kept separate." },
  { icon: Sparkles, title: "AI fleet assistant", text: "Ask “which trucks are due this week?” and get the list." },
  { icon: Bell, title: "Team roles", text: "Owner, admin, specialist and view-only access." },
];

/** Prebuilt and the same for everyone: signed-in people reach their fleet through Log in (/login sends them straight in). */
export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_70%_10%,var(--accent-soft),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
          <div className="max-w-3xl">
            <Eyebrow>Fleet maintenance &amp; compliance for trucking</Eyebrow>
            <h1 className="mt-4 text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[60px]">
              Every truck, every repair, every paper.{" "}
              <span className="bg-linear-to-r from-accent to-progress bg-clip-text text-transparent">On one screen.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-[18px] leading-8 text-fg-muted">
              FleetCore tells your fleet team what needs doing today: the oil change that&apos;s overdue, the insurance
              that expires Friday, the truck that&apos;s been in the shop too long, the defect nobody owns.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/demo" className={bigButton()}>Open the live demo<ArrowRight /></Link>
              <Link href="/pricing" className={bigButton("secondary")}>See pricing</Link>
            </div>
            <p className="mt-4 text-[13px] text-fg-subtle">No sign-up. Watch the one-minute video below, or open the demo fleet and click around.</p>
          </div>
          <div className="mt-14 sm:mt-16">
            <ProductVideo />
          </div>
        </div>
      </section>

      {/* Facts */}
      <section className="border-y border-line bg-surface">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-line px-5 sm:grid-cols-4 sm:divide-x">
          {[["1 screen", "for oil, repairs, papers and PTI"], ["Every morning", "a list of what needs a decision"], ["ELD sync", "odometer, hours and fuel"], ["Many companies", "one sign-in, data kept apart"]].map(([k, v]) => (
            <div key={k} className="px-2 py-7 sm:px-6">
              <dt className="text-[22px] font-semibold tracking-tight">{k}</dt>
              <dd className="mt-1 text-[13px] text-fg-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Pains */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="Sound familiar?" title="Fleets don't break down all at once. They slip, one forgotten thing at a time.">
          Spreadsheets, group chats and sticky notes work until the fleet grows past a few trucks. Then things fall
          through the cracks, and every crack costs a load.
        </SectionHead>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {PAINS.map((p) => (
            <div key={p.title} className="rounded-xl border border-line bg-surface p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-danger-soft text-danger"><p.icon className="h-5 w-5" /></span>
              <h3 className="mt-4 text-[17px] font-semibold">{p.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-fg-muted">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-t border-line bg-surface/40 py-24">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHead eyebrow="The product" title="Built by people who run fleets, for the people who keep them rolling." center>
            FleetCore is made for fleet specialists and maintenance managers: the people who answer &ldquo;is truck 2204
            good to go?&rdquo; twenty times a day.
          </SectionHead>
          <div className="mt-20 space-y-24">
            {FEATURES.map((f, i) => (
              <div key={f.title} className={cn("grid items-center gap-10 lg:gap-14", i % 2 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
                <Reveal className={i % 2 ? "lg:order-2" : undefined}>
                  <Eyebrow>{f.eyebrow}</Eyebrow>
                  <h3 className="mt-3 text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em]" style={{ transitionDelay: "80ms" }}>{f.title}</h3>
                  <p className="mt-4 text-[15px] leading-7 text-fg-muted" style={{ transitionDelay: "160ms" }}>{f.text}</p>
                  <ul className="mt-5 space-y-2.5" style={{ transitionDelay: "240ms" }}>
                    {f.points.map((p, j) => (
                      <li key={p} className="flex gap-2.5 text-[14px]" style={{ transitionDelay: `${380 + j * 120}ms` }}>
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><ClipboardCheck className="h-3 w-3" /></span>{p}
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <MockStage side={i % 2 ? "left" : "right"} className={i % 2 ? "lg:order-1" : undefined}><f.scene /></MockStage>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Everything else */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="And the rest of the job" title="Everything your fleet team keeps track of." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {MORE.map((m) => (
            <div key={m.title} className="bg-surface p-6">
              <m.icon className="h-5 w-5 text-accent" />
              <h3 className="mt-3 text-[15px] font-semibold">{m.title}</h3>
              <p className="mt-1.5 text-[14px] leading-6 text-fg-muted">{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it starts */}
      <section className="border-t border-line bg-surface/40 py-24">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHead eyebrow="Getting started" title="Running in a day, not a quarter." />
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ["Send us your lists", "Trucks, trailers and drivers in any spreadsheet. We load them into your workspace."],
              ["Connect your ELD", "Paste your TrackPro token and odometers, hours and positions start coming in."],
              ["Work the list", "Your team opens Today each morning and clears what needs a decision."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-line bg-surface p-6">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent-text">{i + 1}</span>
                <h3 className="mt-4 text-[17px] font-semibold">{t}</h3>
                <p className="mt-2 text-[14px] leading-6 text-fg-muted">{d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 flex items-center gap-2 text-[14px] text-fg-muted">
            <MapPin className="h-4 w-4 text-accent" />Works for US fleets (miles, gallons, DOT) and metric fleets (km, litres) alike.
          </p>
        </div>
      </section>

      <div className="pt-16"><CtaBand /></div>
    </>
  );
}
