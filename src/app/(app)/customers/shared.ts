import type { Tone } from "@/components/ui";

/* Pure helpers shared by the customers list, detail page and client controls (safe on client and server). */

export const KIND_FILTERS = ["ALL", "SHIPPER", "BROKER"] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

export const KIND_TONE: Record<string, Tone> = { SHIPPER: "info", BROKER: "progress", BOTH: "accent" };
/** Short tag for chips; the long label lives in CUSTOMER_KIND_LABELS. */
export const KIND_SHORT: Record<string, string> = { SHIPPER: "Shipper", BROKER: "Broker", BOTH: "Shipper + broker" };

/** Kinds that count as a shipper / as a broker ("BOTH" is both). Used for filters and database queries alike. */
export const SHIPPER_KINDS = ["SHIPPER", "BOTH"];
export const BROKER_KINDS = ["BROKER", "BOTH"];
export const isBroker = (kind: string) => BROKER_KINDS.includes(kind);

export const ACTIVE_LOAD_STATUSES = ["PLANNED", "ASSIGNED", "IN_TRANSIT"] as const;
export const COMPLETED_LOAD_STATUSES = ["DELIVERED", "INVOICED"] as const;

/** Invoice total including tax (what the customer actually owes). */
export const grossInvoice = (i: { amount: number; taxRate: number }) => i.amount * (1 + i.taxRate);

/** Credit exposure as a share of the limit → tone. Quiet below 60 %, caution to 90 %, problem above. */
export function creditTone(ratio: number): Tone {
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.6) return "warn";
  return "neutral";
}

/** Documents a partner should have on file: every account signs a contract, brokers also send a setup packet. */
export const requiredCustomerDocs = (kind: string): string[] => (isBroker(kind) ? ["CONTRACT", "SETUP_PACKET"] : ["CONTRACT"]);
