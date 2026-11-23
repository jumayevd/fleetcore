/*
 * Content of the public site (/, /pricing, /demo, /contact; served from the Vercel address until there is a domain). Prices and contact details live here so
 * they can change without touching the pages.
 */

export const SITE = {
  name: "FleetCore",
  /** A mailbox to show on the site, or null to send everyone to the contact form. */
  email: null as string | null,
  maker: "Kaizen",
};

/** Trucks covered by a plan's flat monthly price. Above this, every truck is billed at the plan's per-truck price. */
export const FLAT_TRUCKS = 20;

export type Plan = {
  id: string;
  name: string;
  /** Monthly price in USD for 1 to FLAT_TRUCKS trucks. */
  flat: number;
  /** Monthly price in USD per truck above FLAT_TRUCKS trucks (for every truck in the fleet). */
  perTruck: number;
  blurb: string;
  features: string[];
  popular?: boolean;
};

const CORE = [
  "Trucks, trailers and drivers", "Oil changes by odometer", "Repairs, shops and invoices", "Pre-trip walk-arounds and defects",
  "Papers with expiry reminders", "Roadside inspections and DOT corrections", "ELD sync: odometer, engine hours, fuel",
  "Live truck map", "Reports and cost per mile", "Unlimited team members",
];

export const PLANS: Plan[] = [
  {
    id: "standard", name: "Standard", flat: 149, perTruck: 9.99,
    blurb: "Everything your fleet team needs to keep every truck legal and on the road.",
    features: CORE,
  },
  {
    id: "ai", name: "Standard + AI", flat: 199, perTruck: 11.99, popular: true,
    blurb: "All of Standard, plus an assistant that answers questions about your fleet in seconds.",
    features: ["Everything in Standard", "AI fleet assistant", "Ask about trucks, repairs, papers and costs", "Answers from your own fleet data", "Turns answers into actions: book, remind, assign"],
  },
];

/** The outsourced fleet service (/fleet-service): our team runs the maintenance side of the fleet for the customer. */
export const SERVICE = {
  id: "service",
  name: "Fleet service",
  provides: [
    "Oil changes", "Valve adjustments", "DOT inspections", "Weekly PTI coordination and control",
    "Daily breakdowns: shops, roadside, dealers, towing", "Warranty claims", "Repairs and disputes for leased trucks",
    "Daily, weekly and monthly cost tracking, analysis and reports", "Service history reports",
  ],
  /** Monthly price per truck by fleet size; null: agreed case by case. */
  tiers: [
    { trucks: "1–20 trucks", bobtail: 70, withTrailer: 80 },
    { trucks: "21–50 trucks", bobtail: 60, withTrailer: 70 },
    { trucks: "50+ trucks", bobtail: null, withTrailer: null },
  ] as { trucks: string; bobtail: number | null; withTrailer: number | null }[],
  /** Paying per case instead: the range per issue, depending on the case. */
  perCase: { from: 50, to: 100 },
};

/** What the contact form's "Plan" offers: the software plans and the fleet service. */
export const CONTACT_PLANS: { id: string; name: string }[] = [...PLANS.map((p) => ({ id: p.id, name: p.name })), { id: SERVICE.id, name: SERVICE.name }];

/** What a plan costs a month for a fleet of this many trucks. */
export const monthlyPrice = (plan: Plan, trucks: number) => (trucks <= FLAT_TRUCKS ? plan.flat : Math.round(trucks * plan.perTruck * 100) / 100);

export const FAQ: [q: string, a: string][] = [
  ["Can I try it first?", "Watch the tour on the Live demo page, or open the demo fleet and click around yourself. No sign-up. When you're ready, we set up a trial on your own trucks."],
  ["How is the price counted?", `Up to ${FLAT_TRUCKS} trucks you pay one flat monthly price. With more than ${FLAT_TRUCKS} trucks, every truck is billed per month: $9.99 on Standard, $11.99 with AI. Trailers and team members are free.`],
  ["Do I need an ELD?", "No. FleetCore works with readings your team types in. With TrackPro connected, odometer, engine hours and fuel come in on their own."],
  ["Can I move my data in?", "Send us your truck, trailer and driver lists in any spreadsheet. We set up your workspace for you."],
  ["We run several companies. Does that cost more?", "Each company has its own workspace and its own data, and one person can work in all of them with one sign-in. Each company is priced by its own number of trucks."],
  ["Where is my data kept?", "In a managed PostgreSQL database with nightly backups kept for 30 days. Only people you invite can see your company."],
];
