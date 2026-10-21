import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { COMPANY_PROFILE_KEY, companyCompliance, parseCompanyProfile, type CompanyProfile } from "./shared";

/** The active company's profile plus when it was last saved (null until the first save). */
export async function getCompanyProfileRecord(): Promise<{ profile: CompanyProfile; updatedAt: Date | null }> {
  const row = await getSetting(COMPANY_PROFILE_KEY);
  return { profile: parseCompanyProfile(row?.value), updatedAt: row?.updatedAt ?? null };
}

/** Compliance status of the required company documents (licence, insurance, tax certificate). */
export async function getCompanyCompliance() {
  const docs = await db.document.findMany({
    where: { isCompany: true },
    select: { id: true, kind: true, name: true, expiresAt: true, createdAt: true },
  });
  return companyCompliance(docs);
}
