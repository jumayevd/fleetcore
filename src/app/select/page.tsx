import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, LogOut, MailPlus, Truck, UserPlus, Users, Wrench, FileWarning } from "lucide-react";
import { rootDb } from "@/lib/db-root";
import { getSessionContext, listWorkspaces } from "@/lib/session";
import { ROLE_LABELS, isRole } from "@/lib/constants";
import { signOut, signOutAll, switchCompany } from "@/app/actions/auth";
import { Avatar, Chip, LinkButton, cardClass, cn } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { CompanyBadge } from "@/components/workspace-switcher";
import { Wordmark } from "../login/frame";
import { NewCompanyForm, AcceptInviteButton } from "./forms";

export const metadata = { title: "Companies" };

const DAY = 86_400_000;

/** Light per-company numbers for the cards: one grouped query per model across every company shown. */
async function companyStats(ids: string[]) {
  if (!ids.length) return new Map<string, { trucks: number; drivers: number; openWork: number; expiring: number }>();
  const soon = new Date(Date.now() + 30 * DAY);
  const where = { companyId: { in: ids } };
  const [trucks, drivers, work, truckPapers, driverPapers] = await Promise.all([
    rootDb.truck.groupBy({ by: ["companyId"], where: { ...where, status: { not: "INACTIVE" } }, _count: true }),
    rootDb.driver.groupBy({ by: ["companyId"], where: { ...where, status: { not: "INACTIVE" } }, _count: true }),
    rootDb.workOrder.groupBy({ by: ["companyId"], where: { ...where, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } }, _count: true }),
    rootDb.truck.groupBy({
      by: ["companyId"],
      where: { ...where, status: { not: "INACTIVE" }, OR: [{ insuranceExpiry: { lte: soon } }, { inspectionExpiry: { lte: soon } }, { registrationExpiry: { lte: soon } }] },
      _count: true,
    }),
    rootDb.driver.groupBy({ by: ["companyId"], where: { ...where, status: "ACTIVE", OR: [{ licenseExpiry: { lte: soon } }, { medicalExpiry: { lte: soon } }] }, _count: true }),
  ]);
  const n = (rows: { companyId: string; _count: number }[], id: string) => rows.find((r) => r.companyId === id)?._count ?? 0;
  return new Map(ids.map((id) => [id, { trucks: n(trucks, id), drivers: n(drivers, id), openWork: n(work, id), expiring: n(truckPapers, id) + n(driverPapers, id) }]));
}

export default async function SelectCompanyPage({ searchParams }: PageProps<"/select">) {
  const sp = await searchParams;
  const ctx = await getSessionContext();
  if (!ctx.accounts.length) redirect("/login");
  const accounts = await listWorkspaces(ctx.accounts);
  if (!accounts.length) redirect("/login");
  const ids = [...new Set(accounts.flatMap((a) => a.companies.map((c) => c.id)))];
  const [stats, invites] = await Promise.all([
    companyStats(ids),
    rootDb.invite.findMany({
      where: { email: { in: accounts.map((a) => a.email) }, acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { company: { select: { id: true, name: true, color: true } }, invitedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const focus = typeof sp.account === "string" ? sp.account : undefined;
  const total = accounts.reduce((a, x) => a + x.companies.length, 0);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-14 items-center justify-between gap-3 px-4 lg:px-8">
        <Link href={ctx.active ? "/dashboard" : "/select"} aria-label="FleetCore" className="min-w-0"><Wordmark /></Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle className="h-8 border border-line bg-surface px-2" />
          <LinkButton href="/login?add=1" variant="secondary" size="sm" aria-label="Add another account"><UserPlus /><span className="hidden sm:inline">Add another account</span></LinkButton>
          {accounts.length > 1 && <form action={signOutAll} className="hidden sm:block"><button className="h-8 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">Sign out of all</button></form>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 lg:px-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-fg">{total ? "Choose a company" : "Create your first company"}</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          {total
            ? <>Each company keeps its own trucks, drivers and documents. Switch any time from the company menu in the sidebar, or with <span className="num">Alt+1…9</span>.</>
            : "A company is one fleet's workspace. Create one for the fleet you manage, or open an invitation from your manager."}
        </p>

        {invites.length > 0 && (
          <section className="mt-6">
            <h2 className="eyebrow mb-2">Invitations</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {invites.map((inv) => {
                const acc = accounts.find((a) => a.email.toLowerCase() === inv.email.toLowerCase())!;
                return (
                  <div key={inv.id} className={cn(cardClass, "flex items-center gap-3 p-4")}>
                    <CompanyBadge name={inv.company.name} color={inv.company.color} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-fg">{inv.company.name}</p>
                      <p className="truncate text-[12px] text-fg-subtle">
                        <MailPlus className="mr-1 inline h-3 w-3" />{inv.invitedBy?.name ?? "Someone"} invited {inv.email} as {(isRole(inv.role) ? ROLE_LABELS[inv.role] : inv.role).toLowerCase()}
                      </p>
                    </div>
                    <AcceptInviteButton token={inv.token} userId={acc.userId} />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-6 space-y-8">
          {accounts.map((a) => (
            <section key={a.userId} aria-label={a.email} className={cn("scroll-mt-20 rounded-xl", focus === a.userId && "ring-2 ring-accent/30 ring-offset-8 ring-offset-canvas")}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={a.name} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-fg">{a.name}</p>
                    <p className="truncate text-[12px] text-fg-subtle">{a.email}{ctx.active?.user.id === a.userId && " · working now"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {a.platform && <LinkButton href="/platform" variant="secondary" size="sm">Platform console</LinkButton>}
                  <form action={signOut}>
                    <input type="hidden" name="userId" value={a.userId} />
                    <button className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg"><LogOut className="h-3.5 w-3.5" />Sign out of this account</button>
                  </form>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {a.companies.map((c, i) => {
                  const s = stats.get(c.id);
                  const current = ctx.active?.user.id === a.userId && ctx.active.company.id === c.id;
                  return (
                    <form key={c.id} action={switchCompany}>
                      <input type="hidden" name="userId" value={a.userId} />
                      <input type="hidden" name="companyId" value={c.id} />
                      <button autoFocus={i === 0 && (focus ? focus === a.userId : current)}
                        className={cn(cardClass, "group flex h-full w-full flex-col p-4 text-left transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                          current && "border-accent/50")}>
                        <span className="flex w-full items-center gap-3">
                          <CompanyBadge name={c.name} color={c.color} size={40} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-fg">{c.name}</span>
                            <span className="block truncate text-[12px] text-fg-subtle">{a.platform ? "Open as platform owner" : ROLE_LABELS[c.role]}</span>
                          </span>
                          {current ? <Chip tone="accent">Current</Chip> : <ArrowRight className="h-4 w-4 shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted" />}
                        </span>
                        {s && (
                          <span className="mt-4 grid w-full grid-cols-4 gap-2 border-t border-line pt-3 text-[11px] text-fg-subtle">
                            <Figure icon={<Truck />} value={s.trucks} label="trucks" />
                            <Figure icon={<Users />} value={s.drivers} label="drivers" />
                            <Figure icon={<Wrench />} value={s.openWork} label="open jobs" />
                            <Figure icon={<FileWarning />} value={s.expiring} label="expiring" tone={s.expiring ? "warn" : undefined} />
                          </span>
                        )}
                      </button>
                    </form>
                  );
                })}
                {!a.platform && (
                  <div id={a.userId === (ctx.active?.user.id ?? accounts[0].userId) ? "new" : undefined} className="scroll-mt-20">
                    <NewCompanyForm userId={a.userId} first={a.companies.length === 0} />
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function Figure({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone?: "warn" }) {
  return (
    <span className="min-w-0" title={`${value} ${label}`}>
      <span className={cn("num flex items-center gap-1 text-[15px] font-semibold text-fg [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-fg-faint", tone === "warn" && value > 0 && "text-warn")}>{icon}{value}</span>
      <span className="block truncate">{label}</span>
    </span>
  );
}
