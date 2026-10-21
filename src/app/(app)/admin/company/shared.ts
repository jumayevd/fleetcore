/**
 * Client-safe helpers for the company profile: the AppSetting key, the profile shape and the
 * compliance rules for company documents. No Prisma or server-only imports here.
 */

export const COMPANY_PROFILE_KEY = "company.profile";

export type CompanyProfile = {
  legalName: string;
  brand: string;
  taxId: string;
  licenseNumber: string;
  director: string;
  phone: string;
  email: string;
  address: string;
  bank: { name: string; account: string; mfo: string; swift: string };
  insurance: { carrier: string; policy: string; agent: string };
};

const EMPTY_PROFILE: CompanyProfile = {
  legalName: "", brand: "", taxId: "", licenseNumber: "", director: "", phone: "", email: "", address: "",
  bank: { name: "", account: "", mfo: "", swift: "" },
  insurance: { carrier: "", policy: "", agent: "" },
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Tolerant parser: unknown or malformed JSON falls back to an empty profile field by field. */
export function parseCompanyProfile(raw: string | null | undefined): CompanyProfile {
  if (!raw) return EMPTY_PROFILE;
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return EMPTY_PROFILE; }
  const bank = (j.bank ?? {}) as Record<string, unknown>;
  const ins = (j.insurance ?? {}) as Record<string, unknown>;
  return {
    legalName: str(j.legalName), brand: str(j.brand), taxId: str(j.taxId), licenseNumber: str(j.licenseNumber),
    director: str(j.director), phone: str(j.phone), email: str(j.email), address: str(j.address),
    bank: { name: str(bank.name), account: str(bank.account), mfo: str(bank.mfo), swift: str(bank.swift) },
    insurance: { carrier: str(ins.carrier), policy: str(ins.policy), agent: str(ins.agent) },
  };
}

/** Display name: brand first, then legal name. */
export const companyDisplayName = (p: CompanyProfile) => p.brand || p.legalName || "Company profile";

/* ------------------------------------------------------------------ */
/* Company document compliance                                         */
/* ------------------------------------------------------------------ */

/** Documents the company must keep on file (licence, insurance, tax certificate). */
export const REQUIRED_COMPANY_DOCS = ["COMPANY_LICENSE", "COMPANY_INSURANCE", "TAX_CERT"] as const;

export type DocComplianceStatus = "valid" | "expiring" | "expired" | "missing";

export type DocCompliance = {
  kind: string;
  status: DocComplianceStatus;
  /** Days until the governing document expires; null when it has no expiry or is missing. */
  days: number | null;
  doc: { id: string; name: string; expiresAt: Date | null } | null;
};

type DocLike = { id: string; kind: string; name: string; expiresAt: Date | null; createdAt: Date };

/**
 * One row per required kind. The governing document is the one that expires last; a document
 * without an expiry date never lapses. Expiring = 30 days or fewer left.
 */
export function companyCompliance(docs: DocLike[], required: readonly string[] = REQUIRED_COMPANY_DOCS, now = new Date()): DocCompliance[] {
  return required.map((kind) => {
    const mine = docs.filter((d) => d.kind === kind);
    if (!mine.length) return { kind, status: "missing", days: null, doc: null };
    const open = mine.filter((d) => !d.expiresAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (open) return { kind, status: "valid", days: null, doc: open };
    const best = mine.slice().sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime())[0];
    const days = Math.ceil((best.expiresAt!.getTime() - now.getTime()) / 86_400_000);
    return { kind, status: days < 0 ? "expired" : days <= 30 ? "expiring" : "valid", days, doc: best };
  });
}

export function complianceCounts(rows: DocCompliance[]) {
  const n = (s: DocComplianceStatus) => rows.filter((r) => r.status === s).length;
  return { valid: n("valid"), expiring: n("expiring"), expired: n("expired"), missing: n("missing") };
}
