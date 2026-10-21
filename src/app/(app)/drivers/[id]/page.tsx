import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, EyeOff, FileText, Fuel, Headset, Mail, Pencil, Phone, Truck as TruckIcon } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { DRIVER_TYPE_LABELS } from "@/lib/constants";
import { DOC_KIND_LABELS, REQUIRED_DRIVER_DOCS } from "@/lib/documents";
import { ago, daysAgo, daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { DocumentsPanel } from "@/components/documents/panel";
import { Badge, Card, Chip, DL, EmptyState, ExpiryBadge, InfoTip, LinkButton, PageHeader, Stat, StatusDot, Table, Tabs, cn, type Tone } from "@/components/ui";
import { HoldControl } from "./hold-control";
import { EmploymentMenu } from "./employment-menu";
import { TruckAssignment } from "./truck-assignment";
import { truckOptions } from "../data";
import { AT_RISK_SCORE, DRIVER_TYPE_TONE, EMPLOYMENT_LABELS, clearance, riskReasons, scoreGrade, tenure } from "../shared";

const TABS = ["overview", "documents", "fuel"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", documents: "Documents", fuel: "Fuel" };
const DOC_FIELD: Record<string, "licenseExpiry" | "medicalExpiry"> = { LICENSE: "licenseExpiry", MEDICAL: "medicalExpiry" };
const FUEL_DAYS = 90;
const FUEL_ROWS = 50;

export async function generateMetadata({ params }: PageProps<"/drivers/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.driver.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: r?.name ?? "Not found" };
}

export default async function DriverDetail({ params, searchParams }: PageProps<"/drivers/[id]">) {
  const user = await requireUser("drivers.view");
  const f = await getFormat();
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "overview";
  const editable = can(user.role, "drivers.edit");
  const canAssign = editable && can(user.role, "fleet.edit");

  const driver = await db.driver.findUnique({
    where: { id },
    include: {
      truck: { select: { id: true, unitNumber: true, make: true, model: true, year: true, plate: true, status: true, odometerKm: true, locationName: true, lastPingAt: true } },
      _count: { select: { fuelLogs: true } },
    },
  });
  if (!driver) notFound();

  const [docRows, options] = await Promise.all([
    db.document.findMany({ where: { driverId: id, kind: { in: [...REQUIRED_DRIVER_DOCS] } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, name: true, expiresAt: true } }),
    canAssign && driver.status !== "INACTIVE" ? truckOptions(id) : Promise.resolve([]),
  ]);
  const have = new Set(docRows.map((d) => d.kind));
  const missingDocs = REQUIRED_DRIVER_DOCS.filter((k) => !have.has(k));
  const grade = scoreGrade(driver.score);
  const risks = riskReasons(driver);
  const clear = clearance(driver);
  const docsHref = `/drivers/${id}?tab=documents`;
  const editHref = editable ? `/drivers/${id}/edit` : undefined;

  // Triage list: what needs acting on for this driver, most serious first.
  // A row links only where the destination can resolve it; the rest are plain text.
  const attention: { tone: Tone; text: string; href?: string }[] = [];
  if (driver.status !== "INACTIVE" && driver.hold) {
    attention.push({ tone: "warn", text: `On hold${driver.holdReason ? `: ${driver.holdReason}` : ""}. Release the hold from the header when it is resolved.` });
  }
  for (const r of risks) attention.push({ tone: r.tone, text: r.text, href: r.kind === "score" ? editHref : docsHref });
  if (!driver.medicalExpiry) attention.push({ tone: "warn", text: "No medical certificate expiry recorded", href: editHref });
  if (missingDocs.length) {
    attention.push({ tone: "warn", text: `Scans missing: ${missingDocs.map((k) => DOC_KIND_LABELS[k].toLowerCase()).join(", ")}`, href: docsHref });
  }
  if (driver.status === "ACTIVE" && !driver.truck) attention.push({ tone: "info", text: "No truck assigned", href: canAssign ? `/drivers/${id}#truck` : undefined });
  attention.sort((a, b) => toneRank(a.tone) - toneRank(b.tone));

  const tabs = TABS.map((t) => ({
    key: t, label: TAB_LABELS[t], href: `/drivers/${id}${t === "overview" ? "" : `?tab=${t}`}`,
    count: t === "documents" ? missingDocs.length || undefined : t === "fuel" ? driver._count.fuelLogs || undefined : undefined,
  }));

  return (
    <>
      <PageHeader
        title={driver.name}
        subtitle={
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5" title={clear.reasons.join(" · ") || undefined}>
              <Badge value={clear.label} tone={clear.tone} label={clear.cleared ? "Cleared to drive" : clear.label} dot />
              {clear.detail && <span className="max-w-80 truncate text-[12px] text-fg-muted">{clear.detail}</span>}
            </span>
            <Chip tone={DRIVER_TYPE_TONE[driver.type]}>{DRIVER_TYPE_LABELS[driver.type] ?? driver.type}</Chip>
            {driver.truck
              ? <span className="inline-flex items-center gap-1.5 text-fg-muted"><TruckIcon className="h-3.5 w-3.5" />Drives <Link href={`/fleet/${driver.truck.id}`} className="num font-medium text-fg hover:underline">{driver.truck.unitNumber}</Link></span>
              : <span className="inline-flex items-center gap-1.5 text-fg-subtle"><TruckIcon className="h-3.5 w-3.5" />No truck</span>}
            {driver.dispatcher && <span className="inline-flex items-center gap-1.5 text-fg-muted"><Headset className="h-3.5 w-3.5" />Dispatch {driver.dispatcher}</span>}
          </span>
        }
        actions={editable && (
          <>
            <HoldControl id={id} name={driver.name} hold={driver.hold} reason={driver.holdReason} />
            <EmploymentMenu id={id} status={driver.status} />
            <LinkButton href={`/drivers/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
          </>
        )}
      />

      <Tabs active={tab} tabs={tabs} />

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="Needs attention" flush actions={attention.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{attention.length}</span>}>
              {attention.length === 0 ? (
                <p className="flex items-center gap-2 px-4 pb-3 pt-1 text-[13px] text-fg-muted">
                  <StatusDot tone="ok" />
                  {driver.status === "ACTIVE" ? `Nothing open: cleared to drive, papers in date, safety score ${driver.score}.` : `Nothing open. ${driver.name} is ${(EMPLOYMENT_LABELS[driver.status] ?? driver.status).toLowerCase()}.`}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {attention.map((a, i) => (
                    <li key={i}>
                      {a.href ? (
                        <Link href={a.href} className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg hover:bg-raised">
                          <StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span><ChevronRight className="h-3.5 w-3.5 text-fg-faint" />
                        </Link>
                      ) : (
                        <p className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg"><StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span></p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card id="truck" title="Truck" icon={<TruckIcon />}
              actions={driver.truck && <Link href={`/fleet/${driver.truck.id}`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Open truck →</Link>}>
              {driver.truck ? (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/fleet/${driver.truck.id}`} className="num text-[15px] font-semibold text-fg hover:underline">{driver.truck.unitNumber}</Link>
                      <Badge value={driver.truck.status} />
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-fg-muted">{driver.truck.year} {driver.truck.make} {driver.truck.model} · <span className="num">{driver.truck.plate}</span></p>
                    <p className="mt-0.5 text-[11px] text-fg-subtle">
                      <span className="num">{f.dist(driver.truck.odometerKm)}</span>
                      {driver.truck.locationName && <> · {driver.truck.locationName}{driver.truck.lastPingAt && ` · ${ago(driver.truck.lastPingAt)}`}</>}
                    </p>
                  </div>
                  {canAssign && <TruckAssignment driverId={id} driverName={driver.name} current={{ id: driver.truck.id, unitNumber: driver.truck.unitNumber }} options={options.filter((o) => o.value !== driver.truck?.id)} />}
                </div>
              ) : driver.status === "INACTIVE" ? (
                <p className="text-[13px] text-fg-muted">No truck. Inactive drivers can&apos;t be given one; set {driver.name} back to active first.</p>
              ) : canAssign ? (
                <div className="space-y-2">
                  <p className="text-[13px] text-fg-muted">{driver.name} has no truck yet.</p>
                  <TruckAssignment driverId={id} driverName={driver.name} current={null} options={options} />
                </div>
              ) : (
                <p className="text-[13px] text-fg-muted">No truck assigned.</p>
              )}
            </Card>

            <Card title={<span className="flex items-center gap-1.5">Licence &amp; medical<InfoTip>Expired papers mean the driver is not cleared to drive; papers expiring within 30 days mark them at risk. Dates come from the driver record; edit the driver to change them.</InfoTip></span>}
              icon={<FileText />} flush
              actions={<Link href={docsHref} className="text-[11px] font-medium text-fg-muted hover:text-fg">Documents →</Link>}>
              <Table dense stickyHead={false} head={["Paper", "Number", "Expires", "Scan"]}>
                {REQUIRED_DRIVER_DOCS.map((kind) => {
                  const doc = docRows.find((d) => d.kind === kind);
                  const expiry = driver[DOC_FIELD[kind]];
                  return (
                    <tr key={kind}>
                      <td className="text-fg">{DOC_KIND_LABELS[kind]}</td>
                      <td className="num text-fg-muted">{kind === "LICENSE" ? `${driver.licenseNumber} · ${driver.licenseClass}` : "—"}</td>
                      <td>
                        {expiry
                          ? <span className="inline-flex items-center gap-2"><span className="num text-fg-muted">{f.date(expiry)}</span><ExpiryBadge days={daysUntil(expiry)} /></span>
                          : editHref ? <Link href={editHref} className="text-[12px] font-medium text-warn hover:underline">Add the date</Link> : <span className="text-[12px] text-warn">Not recorded</span>}
                      </td>
                      <td>
                        {doc
                          ? <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" title={`Open ${doc.name}`} className="inline-flex"><Badge value="DONE" label="On file" /></a>
                          : <Link href={docsHref} className="inline-flex"><Badge value="MISSING" tone="warn" label={editable ? "Upload" : "Missing"} /></Link>}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Contact">
              <DL cols={1} items={[
                ["Phone", driver.phone ? <a key="p" href={`tel:${driver.phone}`} className="num inline-flex items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5 text-fg-subtle" />{driver.phone}</a> : "—"],
                ["Second phone", driver.phone2 ? <a key="p2" href={`tel:${driver.phone2}`} className="num hover:underline">{driver.phone2}</a> : "—"],
                ["Email", driver.email ? <a key="e" href={`mailto:${driver.email}`} className="inline-flex items-center gap-1.5 hover:underline"><Mail className="h-3.5 w-3.5 text-fg-subtle" />{driver.email}</a> : "—"],
              ]} />
            </Card>

            <Card title="Employment">
              <DL items={[
                ["Status", <Badge key="st" value={driver.status} label={EMPLOYMENT_LABELS[driver.status] ?? driver.status} dot />],
                ["Type", DRIVER_TYPE_LABELS[driver.type] ?? driver.type],
                ["Dispatcher", driver.dispatcher
                  ? <Link key="dp" href={`/drivers?dispatcher=${encodeURIComponent(driver.dispatcher)}`} className="hover:underline" title={`All drivers dispatched by ${driver.dispatcher}`}>{driver.dispatcher}</Link>
                  : editHref ? <Link key="dp" href={editHref} className="text-[12px] font-medium text-warn hover:underline">Set the dispatcher</Link> : "—"],
                ["Hired", <span key="h"><span className="num">{f.date(driver.hireDate)}</span> <span className="text-fg-subtle">· {tenure(driver.hireDate)}</span></span>],
                ["Safety score", (
                  <span key="s" className="inline-flex items-center gap-1.5">
                    <Badge value={grade.grade} tone={grade.tone} label={`${grade.grade} · ${driver.score}`} className="num" />
                    <InfoTip>Grade A from 90 · B from 80 · C from 70 · D below. Under {AT_RISK_SCORE} marks the driver at risk.</InfoTip>
                  </span>
                )],
                ["On hold", driver.hold ? <span key="hd" className="text-warn">{driver.holdReason ?? "Yes"}</span> : "No"],
              ]} />
            </Card>

            <Card title="Notes">
              {driver.notes ? <p className="whitespace-pre-wrap text-[13px] text-fg">{driver.notes}</p>
                : <p className="text-[12px] text-fg-muted">No notes.{editable && <> Add languages, restrictions or anything the fleet office should know on the <Link href={`/drivers/${id}/edit`} className="text-fg hover:underline">edit form</Link>.</>}</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DocumentsPanel user={user} target={{ type: "driver", id }} path={`/drivers/${id}`} withExpiry required={[...REQUIRED_DRIVER_DOCS]} defaultKind={missingDocs[0]} />
          </div>
          <Card title={
            <span className="flex items-center gap-1.5">Required paperwork
              <InfoTip>A licence and a medical certificate scan must be on file for every driver. Set the expiry when you upload so renewals show on the roster and in alerts.</InfoTip>
            </span>
          } flush>
            <Table dense stickyHead={false} head={["Document", "On file",
              <span key="exp" className="inline-flex items-center gap-1">Expires<InfoTip>From the uploaded scan when it has a date, otherwise from the driver record. Edit the driver to change recorded dates.</InfoTip></span>]}>
              {REQUIRED_DRIVER_DOCS.map((kind) => {
                const doc = docRows.find((d) => d.kind === kind);
                const recorded = driver[DOC_FIELD[kind]];
                const expiry = doc?.expiresAt ?? recorded;
                return (
                  <tr key={kind}>
                    <td>
                      <div className="text-fg">{DOC_KIND_LABELS[kind]}</div>
                      {doc && <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="block max-w-44 truncate text-[11px] text-fg-subtle hover:underline">{doc.name}</a>}
                    </td>
                    <td>{doc ? <Badge value="DONE" label="Present" /> : <Badge value="MISSING" tone="warn" label="Missing" />}</td>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        <ExpiryBadge days={daysUntil(expiry)} />
                        {expiry && <span className="text-[11px] text-fg-subtle">{f.date(expiry)}{!doc?.expiresAt && recorded ? " · from record" : ""}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      )}

      {tab === "fuel" && <FuelTab driverId={id} truck={driver.truck} canLog={can(user.role, "fleet.edit")} showMoney={can(user.role, "money.view")} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

const TONE_RANK: Partial<Record<Tone, number>> = { danger: 0, warn: 1, info: 2 };
const toneRank = (t: Tone) => TONE_RANK[t] ?? 3;

/** Fills logged while this driver had the truck (FuelLog.driverId), newest first, with 90-day totals. */
async function FuelTab({ driverId, truck, canLog, showMoney }: { driverId: string; truck: { id: string; unitNumber: string } | null; canLog: boolean; showMoney: boolean }) {
  const fmt = await getFormat();
  const [recent, logs] = await Promise.all([
    db.fuelLog.aggregate({ where: { driverId, date: { gte: daysAgo(FUEL_DAYS) } }, _sum: { liters: true, cost: true }, _count: true }),
    db.fuelLog.findMany({
      where: { driverId }, orderBy: { date: "desc" }, take: FUEL_ROWS,
      select: { id: true, date: true, liters: true, cost: true, odometerKm: true, station: true, truck: { select: { id: true, unitNumber: true } } },
    }),
  ]);
  const volume = recent._sum.liters ?? 0;
  const cost = recent._sum.cost ?? 0;
  const vol = fmt.labels.volume;
  const logHere = canLog && truck && <LinkButton href={`/fleet/${truck.id}?tab=expenses`} variant="secondary" size="sm"><Fuel />Log fuel on {truck.unitNumber}</LinkButton>;

  return (
    <>
      <div className={cn("mb-4 grid grid-cols-2 gap-3", showMoney ? "md:grid-cols-4" : "md:grid-cols-2")}>
        <Stat label={`Fills · ${FUEL_DAYS}d`} value={fmt.number(recent._count)} icon={<Fuel />} />
        <Stat label={`Fuel (${vol}) · ${FUEL_DAYS}d`} value={fmt.decimal(volume)} />
        {showMoney && <Stat label={`Spend · ${FUEL_DAYS}d`} value={fmt.money(cost)} />}
        {showMoney && <Stat label={`Average price per ${vol}`} value={volume ? fmt.money3(cost / volume) : "—"} hint={`Over the last ${FUEL_DAYS} days`} />}
      </div>
      <Card title="Fuel log" flush icon={<Fuel />}
        actions={<span className="flex items-center gap-2">
          {!showMoney && <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle"><EyeOff className="h-3.5 w-3.5" />Costs hidden for your role</span>}
          {logs.length === FUEL_ROWS && <span className="text-[11px] text-fg-subtle">Latest {FUEL_ROWS}</span>}{logHere}
        </span>}>
        <Table dense stickyHead={false} head={["Date", "Truck", "Station", fmt.labels.volumeLong[0].toUpperCase() + fmt.labels.volumeLong.slice(1), ...(showMoney ? ["Cost", `Per ${vol}`] : []), "Odometer"]}>
          {logs.map((x) => (
            <tr key={x.id}>
              <td className="num whitespace-nowrap text-fg-muted">{fmt.date(x.date)}</td>
              <td><Link href={`/fleet/${x.truck.id}`} className="num font-medium text-fg hover:underline">{x.truck.unitNumber}</Link></td>
              <td className="max-w-48 truncate">{x.station ?? <span className="text-fg-faint">—</span>}</td>
              <td className="num">{fmt.decimal(x.liters)}</td>
              {showMoney && <>
                <td className="num">{fmt.money2(x.cost)}</td>
                <td className="num text-fg-muted">{x.liters ? fmt.money3(x.cost / x.liters) : "—"}</td>
              </>}
              <td className={cn("num text-fg-muted", !x.odometerKm && "text-fg-faint")}>{x.odometerKm ? fmt.dist(x.odometerKm) : "—"}</td>
            </tr>
          ))}
        </Table>
        {logs.length === 0 && (
          <EmptyState icon={<Fuel />} title="No fuel logged for this driver"
            description={truck ? `Fills logged on ${truck.unitNumber} while this driver has it show up here.` : "Fills logged on a truck while this driver has it show up here. Give them a truck first."}
            action={logHere || undefined} />
        )}
      </Card>
    </>
  );
}
