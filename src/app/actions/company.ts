"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { COMPANY_PROFILE_KEY, type CompanyProfile } from "@/app/(app)/admin/company/shared";

/**
 * Save the company profile (legal entity, contacts, bank details, insurance) as JSON in
 * AppSetting "company.profile". Other modules read the setting directly; this module reads it
 * through src/app/(app)/admin/company/profile.ts.
 */
export async function saveCompanyProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    const f = fields(fd);
    const opt = (k: string) => f.str(k) ?? "";
    const email = opt("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FormError("Company email doesn't look like an email address");
    const profile: CompanyProfile = {
      legalName: f.req("legalName", "Legal name"),
      brand: opt("brand"),
      taxId: opt("taxId"),
      licenseNumber: opt("licenseNumber"),
      director: opt("director"),
      phone: opt("phone"),
      email: email.toLowerCase(),
      address: opt("address"),
      bank: { name: opt("bankName"), account: opt("bankAccount"), mfo: opt("bankMfo"), swift: opt("bankSwift") },
      insurance: { carrier: opt("insuranceCarrier"), policy: opt("insurancePolicy"), agent: opt("insuranceAgent") },
    };
    const value = JSON.stringify(profile);
    await db.appSetting.upsert({ where: { key: COMPANY_PROFILE_KEY }, update: { value }, create: { key: COMPANY_PROFILE_KEY, value } });
    await audit(me.id, "update", "company", "company", `Profile saved · ${profile.legalName}`);
    revalidatePath("/admin/company");
    return { ok: "Company profile saved" };
  });
}
