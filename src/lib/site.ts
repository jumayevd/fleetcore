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

export type Plan = {
  id: string;
  name: string;
  /** Monthly price in USD; null = priced per fleet. */
  price: number | null;
  trucks: string;
  blurb: string;
  features: string[];
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "starter", name: "Starter", price: 79, trucks: "Up to 10 trucks",
    blurb: "For a small fleet that has outgrown the spreadsheet.",
    features: ["Trucks, trailers and drivers", "Oil changes by odometer", "Repairs and shop time", "Documents with expiry reminders", "Pre-trip walk-arounds and defects", "2 team members"],
  },
  {
    id: "fleet", name: "Fleet", price: 249, trucks: "Up to 50 trucks", popular: true,
    blurb: "For a growing carrier with a fleet team and outside shops.",
    features: ["Everything in Starter", "ELD sync: odometer, engine hours, fuel", "Live truck map", "Vendors, invoices and cost per mile", "Roadside inspections and DOT corrections", "Email shops from FleetCore", "Unlimited team members"],
  },
  {
    id: "enterprise", name: "Enterprise", price: null, trucks: "50+ trucks or several companies",
    blurb: "For fleet managers running several companies, or large fleets.",
    features: ["Everything in Fleet", "Several companies, one sign-in", "AI fleet assistant", "Data import from your spreadsheets", "Onboarding and training for your team", "Priority support"],
  },
];

export const FAQ: [q: string, a: string][] = [
  ["Can I try it first?", "Open the live demo right now, no sign-up. When you're ready, we set up a trial on your own trucks."],
  ["Do I need an ELD?", "No. FleetCore works with readings your team types in. With TrackPro connected, odometer, engine hours and fuel come in on their own."],
  ["Can I move my data in?", "Send us your truck, trailer and driver lists in any spreadsheet. We set up your workspace for you."],
  ["We run several companies. Does that cost more?", "Each company has its own workspace and its own data. One person can work in all of them with one sign-in. Talk to us about Enterprise."],
  ["Where is my data kept?", "In a managed PostgreSQL database with nightly backups kept for 30 days. Only people you invite can see your company."],
];
