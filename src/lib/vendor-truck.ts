import { FormError } from "@/lib/action";

/**
 * A vendor truck (another person's or company's truck, Truck.isVendor) records whose it is and the share of its
 * earnings the company keeps. Both are required when a truck is marked as a vendor's: on the truck form and from the
 * status menu.
 */
export function vendorTerms(name: string | null | undefined, keepPct: number | null | undefined) {
  const vendorName = name?.trim() || null;
  if (!vendorName) throw new FormError("Enter the vendor's name: the person or company whose truck it is.");
  if (keepPct == null || Number.isNaN(keepPct)) throw new FormError("Enter the share the company keeps, in %.");
  if (keepPct < 0 || keepPct > 100) throw new FormError("The share the company keeps is a percentage from 0 to 100.");
  return { vendorName, vendorKeepPct: Math.round(keepPct * 100) / 100 };
}

/** "Ali Karimov · company keeps 20%", for the truck page and the Vendor chip. */
export function vendorSummary(t: { vendorName: string | null; vendorKeepPct: number | null }) {
  const keeps = t.vendorKeepPct != null ? `company keeps ${t.vendorKeepPct}%` : null;
  return [t.vendorName ?? "Owner not recorded", keeps].filter(Boolean).join(" · ");
}
