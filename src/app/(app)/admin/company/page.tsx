import { BadgeCheck, CalendarClock, FileWarning, FileX2, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DOC_KIND_LABELS } from "@/lib/documents";
import { ago } from "@/lib/format";
import { db } from "@/lib/db";
import { normalizeLocale, type Formatter } from "@/lib/locale";
import { getFormat } from "@/lib/format-server";
import { saveCompanyProfile } from "@/app/actions/company";
import { ActionForm, SubmitButton } from "@/components/forms";
import { DocumentsPanel } from "@/components/documents/panel";
import { Badge, Card, Field, InfoTip, Input, LinkButton, PageHeader, Stat, Textarea, type Tone } from "@/components/ui";
import { getCompanyCompliance, getCompanyProfileRecord } from "./profile";
import { REQUIRED_COMPANY_DOCS, complianceCounts, type DocCompliance, type DocComplianceStatus } from "./shared";
import { ColorPicker, DeleteCompany, RegionSettings } from "./controls";

export const metadata = { title: "Company profile" };

const STATUS_TONE: Record<DocComplianceStatus, Tone> = { valid: "ok", expiring: "warn", expired: "danger", missing: "danger" };
const STATUS_LABEL: Record<DocComplianceStatus, string> = { valid: "Valid", expiring: "Expiring", expired: "Expired", missing: "Missing" };
const kindLabel = (k: string) => DOC_KIND_LABELS[k] ?? k;

function statusText(r: DocCompliance, date: Formatter["date"]) {
  if (r.status === "missing") return "Not uploaded";
  if (r.days === null) return "No expiry date";
  if (r.days < 0) return `Expired ${-r.days}d ago · ${date(r.doc?.expiresAt)}`;
  return `${r.days}d left · until ${date(r.doc?.expiresAt)}`;
}

export default async function CompanyPage() {
  const user = await requireUser("company.manage");
  const [{ profile, updatedAt }, compliance, trucks, fuelLogs, f] = await Promise.all([
    getCompanyProfileRecord(), getCompanyCompliance(), db.truck.count(), db.fuelLog.count(), getFormat(),
  ]);
  const zones = Intl.supportedValuesOf("timeZone");
  const date = f.date;
  const us = f.imperial;

  const counts = complianceCounts(compliance);
  const names = (s: DocComplianceStatus) => compliance.filter((r) => r.status === s).map((r) => kindLabel(r.kind)).join(", ");
  const insurance = compliance.find((r) => r.kind === "COMPANY_INSURANCE");
  const problems = counts.expired + counts.missing;
  const subtitle = [profile.legalName && profile.legalName !== user.company.name ? profile.legalName : null, updatedAt ? `Saved ${ago(updatedAt)}` : "Not saved yet"]
    .filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title={user.company.name}
        subtitle={subtitle}
        actions={
          <>
            <LinkButton href="/admin/members" variant="secondary"><Users />Members</LinkButton>
            <LinkButton href="/admin/audit?entity=company" variant="ghost">Change history</LinkButton>
          </>
        }
      />

      {/* Compliance summary: the three documents the company must keep valid */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Valid documents" value={`${counts.valid}/${REQUIRED_COMPANY_DOCS.length}`} tone={counts.valid === REQUIRED_COMPANY_DOCS.length ? "ok" : "neutral"} icon={<BadgeCheck />}
          hint={counts.valid ? names("valid") : "none of the required documents is valid"} />
        <Stat label="Expiring within 30 days" value={counts.expiring} tone={counts.expiring ? "warn" : "neutral"} icon={<CalendarClock />}
          hint={counts.expiring ? names("expiring") : "nothing is due for renewal"} />
        <Stat label="Expired" value={counts.expired} tone={counts.expired ? "danger" : "neutral"} icon={<FileWarning />}
          hint={counts.expired ? names("expired") : "nothing has lapsed"} />
        <Stat label="Missing" value={counts.missing} tone={counts.missing ? "danger" : "neutral"} icon={<FileX2 />}
          hint={counts.missing ? names("missing") : "everything required is on file"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Profile form */}
        <div className="space-y-4 xl:col-span-2">
          <ActionForm action={saveCompanyProfile} className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={<span className="flex items-center gap-1.5">Workspace<InfoTip>How this company appears in the company menu, so everyone can tell their companies apart at a glance.</InfoTip></span>}>
                <div className="space-y-3">
                  <Field label="Company name" required><Input name="name" required maxLength={80} defaultValue={user.company.name} /></Field>
                  <Field label="Badge colour"><ColorPicker name="color" value={user.company.color} companyName={user.company.name} /></Field>
                </div>
              </Card>

              <Card title="Legal entity">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Legal name" className="sm:col-span-2"><Input name="legalName" defaultValue={profile.legalName} placeholder="Fleet Logistics LLC" /></Field>
                  <Field label="Director"><Input name="director" defaultValue={profile.director} placeholder="Full name" /></Field>
                  <Field label={us ? "EIN / tax ID" : "Tax ID"}><Input name="taxId" defaultValue={profile.taxId} placeholder={us ? "12-3456789" : "123456789"} className="num" /></Field>
                  <Field label={us ? "USDOT / MC number" : "Carrier licence number"} className="sm:col-span-2"><Input name="licenseNumber" defaultValue={profile.licenseNumber} placeholder={us ? "USDOT 1234567 · MC 123456" : "AA 0000000"} className="num" /></Field>
                </div>
              </Card>

              <Card title="Contacts">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Phone"><Input name="phone" type="tel" defaultValue={profile.phone} placeholder={us ? "(555) 010-0100" : "+998 71 000 00 00"} className="num" /></Field>
                  <Field label="Email"><Input name="email" type="email" defaultValue={profile.email} placeholder="office@company.com" /></Field>
                  <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={profile.address} placeholder="Street, city, postcode, country" /></Field>
                </div>
              </Card>

              <Card title="Insurance">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Carrier (insurer)" className="sm:col-span-2"><Input name="insuranceCarrier" defaultValue={profile.insurance.carrier} placeholder="Insurance company" /></Field>
                  <Field label="Policy number"><Input name="insurancePolicy" defaultValue={profile.insurance.policy} placeholder="Policy no." className="num" /></Field>
                  <Field label="Agent / contact"><Input name="insuranceAgent" defaultValue={profile.insurance.agent} placeholder="Name, phone" /></Field>
                </div>
                {insurance && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                    <Badge value={insurance.status} tone={STATUS_TONE[insurance.status]} label={`Certificate ${STATUS_LABEL[insurance.status].toLowerCase()}`} />
                    <span>{statusText(insurance, date)}{insurance.status === "missing" && " — upload it under Company documents"}</span>
                  </p>
                )}
              </Card>

              <Card title={<span className="flex items-center gap-1.5">Bank details<InfoTip>For reference: lessors, insurers and shops ask for them.</InfoTip></span>} className="lg:col-span-2">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Bank" className="sm:col-span-2"><Input name="bankName" defaultValue={profile.bank.name} placeholder="Bank name and branch" /></Field>
                  <Field label="Account number" className="sm:col-span-2"><Input name="bankAccount" defaultValue={profile.bank.account} placeholder={us ? "000123456789" : "2020 8000 0000 0000 0000"} className="num" /></Field>
                  <Field label={us ? "Routing (ABA)" : "MFO / routing"}><Input name="bankMfo" defaultValue={profile.bank.mfo} placeholder={us ? "021000021" : "00000"} className="num" /></Field>
                  <Field label="SWIFT / BIC"><Input name="bankSwift" defaultValue={profile.bank.swift} placeholder={us ? "XXXXUS33" : "XXXXUZ22"} className="num" /></Field>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                {updatedAt ? <>Last saved <span className="num">{ago(updatedAt)}</span></> : "Nothing saved yet."}
                <InfoTip side="top">Changes are recorded in the audit log.</InfoTip>
              </p>
              <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
            </div>
          </ActionForm>

          {can(user.role, "company.delete") && <DeleteCompany name={user.company.name} />}
        </div>

        {/* Region, compliance detail + documents */}
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Region &amp; units<InfoTip>Every distance, volume and weight in this company is in these units, and every date and time is in this time zone — for everyone, wherever they sign in from. The top bar shows your own clock next to it.</InfoTip></span>}>
            <RegionSettings locale={normalizeLocale(user.company)} zones={zones} counts={{ trucks, fuelLogs }} />
          </Card>

          <Card flush
            title={
              <span className="flex items-center gap-1.5">Compliance
                <InfoTip>Expiring means 30 days or fewer left. The newest document of each kind counts; one without an expiry date never lapses. Set the expiry when you upload so renewals show up here and on the overview.</InfoTip>
              </span>
            }
            actions={problems ? <Badge value="HIGH" tone="danger" label={`${problems} to fix`} /> : counts.expiring ? <Badge value="HIGH" tone="warn" label="Renewal due" /> : <Badge value="ACTIVE" tone="ok" label="All in order" />}>
            <ul className="divide-y divide-line">
              {compliance.map((r) => (
                <li key={r.kind} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-fg">
                      {r.doc ? <a href={`/api/documents/${r.doc.id}`} target="_blank" rel="noreferrer" className="hover:underline">{kindLabel(r.kind)}</a> : kindLabel(r.kind)}
                    </p>
                    <p className="truncate text-[11px] text-fg-subtle">{statusText(r, date)}</p>
                  </div>
                  <Badge value={r.status} tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} dot />
                </li>
              ))}
            </ul>
          </Card>

          <DocumentsPanel user={user} target={{ type: "company", id: "company" }} path="/admin/company" title="Company documents"
            withExpiry required={REQUIRED_COMPANY_DOCS} />
        </div>
      </div>
    </>
  );
}
