"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rootDb } from "@/lib/db-root";
import { writeActive } from "@/lib/session";
import { createPasswordLink, requirePlatformOwner } from "@/lib/platform";

/*
 * The Platform console (/platform): platform owners only. Opening a company and making password links are audited.
 */

async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Work in a company as its owner without joining it. */
export async function openCompanyAsPlatform(fd: FormData) {
  const me = await requirePlatformOwner();
  const companyId = String(fd.get("companyId") ?? "");
  const company = await rootDb.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) redirect("/platform");
  await writeActive(me.id, company.id);
  await rootDb.auditLog.create({ data: { companyId: company.id, userId: me.id, action: "open", entity: "company", entityId: company.id, details: "Opened as platform owner" } });
  redirect("/dashboard");
}

/** A one-time link for an account to set its password (valid 3 days). Shown once; send it to the person yourself. */
export async function makePasswordLink(userId: string): Promise<{ url?: string; error?: string }> {
  const me = await requirePlatformOwner();
  const user = await rootDb.user.findUnique({ where: { id: userId }, select: { id: true, email: true, active: true } });
  if (!user || !user.active) return { error: "This account can't sign in, so it can't get a password link." };
  const token = await createPasswordLink(user.id, me.id);
  await rootDb.auditLog.create({ data: { companyId: null, userId: me.id, action: "password_link", entity: "user", entityId: user.id, details: user.email } });
  return { url: `${await origin()}/reset/${token}` };
}
