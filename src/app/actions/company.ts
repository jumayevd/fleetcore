"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rootDb } from "@/lib/db-root";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { deleteFile } from "@/lib/storage";
import { forgetSessions, writeActive } from "@/lib/session";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { COMPANY_COLORS } from "@/lib/constants";
import { isTimeZone, isUnitSystem, normalizeLocale } from "@/lib/locale";
import { convertCompanyUnits } from "@/lib/units-convert";
import { COMPANY_PROFILE_KEY, type CompanyProfile } from "@/app/(app)/admin/company/shared";

/**
 * Save the workspace name and colour (Company) and the company profile (legal entity, contacts, bank details,
 * insurance) as JSON in the company's AppSetting "company.profile".
 */
export async function saveCompanyProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    const f = fields(fd);
    const opt = (k: string) => f.str(k) ?? "";
    const name = f.req("name", "Company name");
    if (name.length > 80) throw new FormError("Keep the company name under 80 characters.");
    const color = f.str("color");
    if (color && !(COMPANY_COLORS as readonly string[]).includes(color)) throw new FormError("Pick one of the colours.");
    const email = opt("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FormError("Company email doesn't look like an email address");
    const profile: CompanyProfile = {
      legalName: opt("legalName"),
      brand: "",
      taxId: opt("taxId"),
      licenseNumber: opt("licenseNumber"),
      director: opt("director"),
      phone: opt("phone"),
      email: email.toLowerCase(),
      address: opt("address"),
      bank: { name: opt("bankName"), account: opt("bankAccount"), mfo: opt("bankMfo"), swift: opt("bankSwift") },
      insurance: { carrier: opt("insuranceCarrier"), policy: opt("insurancePolicy"), agent: opt("insuranceAgent") },
    };
    await rootDb.company.update({ where: { id: me.company.id }, data: { name, ...(color ? { color } : {}) } });
    await setSetting(COMPANY_PROFILE_KEY, JSON.stringify(profile));
    forgetSessions();
    await audit(me.id, "update", "company", me.company.id, `Profile saved · ${name}`);
    revalidatePath("/", "layout");
    return { ok: "Company profile saved" };
  });
}

/**
 * Units, time zone and currency. Switching units relabels every stored number; with "convert" ticked the numbers are
 * converted too (odometers, intervals, fuel volumes, weights), so a 600,000 km odometer becomes 372,823 mi.
 */
export async function saveCompanyRegion(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    const f = fields(fd);
    const units = f.req("units", "Units");
    if (!isUnitSystem(units)) throw new FormError("Pick imperial or metric.");
    const timezone = f.req("timezone", "Time zone");
    if (!isTimeZone(timezone)) throw new FormError("That time zone isn't recognised.");
    const currency = f.req("currency", "Currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new FormError("Use a three-letter currency code, like USD.");
    const from = normalizeLocale(me.company).units;
    const convert = from !== units && f.bool("convert");
    if (convert) await convertCompanyUnits(me.company.id, from, units);
    await rootDb.company.update({ where: { id: me.company.id }, data: { units, timezone, currency } });
    forgetSessions();
    const changes = [
      from !== units && `units ${from} → ${units}${convert ? " (values converted)" : ""}`,
      timezone !== me.company.timezone && `time zone ${timezone}`,
      currency !== me.company.currency && `currency ${currency}`,
    ].filter(Boolean);
    await audit(me.id, "update", "company", me.company.id, changes.length ? `Region: ${changes.join(", ")}` : "Region saved");
    revalidatePath("/", "layout");
    return { ok: convert ? "Saved — every distance, volume and weight was converted" : "Region and units saved" };
  });
}

/** Delete the active company and everything in it. Owners only, and they must type the name. */
export async function deleteCompany(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("company.delete");
  const res = await attempt(async () => {
    if (fields(fd).str("confirm") !== me.company.name) throw new FormError(`Type ${me.company.name} exactly to confirm.`);
    const files = await db.document.findMany({ select: { storageKey: true } });
    await rootDb.company.delete({ where: { id: me.company.id } });
    await Promise.all(files.map((d) => deleteFile(d.storageKey)));
    await rootDb.auditLog.create({ data: { companyId: null, userId: me.id, action: "delete", entity: "company", entityId: me.company.id, details: me.company.name } });
    await writeActive(me.id, null);
    forgetSessions();
  });
  if (res?.error) return res;
  redirect("/select");
}
