import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Clock, Plus, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { INSPECTION_LEVELS, INSPECTION_LEVEL_LABELS, ROADSIDE_RESULTS, ROADSIDE_STATUSES } from "@/lib/constants";
import {
  DAY_MS, ROADSIDE_RESULT_TONE, ROADSIDE_STATUS_TONE, levelShort, one, roadsideHref, roadsideResultLabel, roadsideStatusLabel,
} from "@/lib/pti-shared";
import { Badge, Card, Chip, LinkButton, PageHeader, Stat, Table, cn } from "@/components/ui";
import { ListFilters } from "@/components/inspections/list-filters";

export const metadata = { title: "Roadside inspections" };

const PAGE = 300;

export default async function RoadsidePage({ searchParams }: PageProps<"/inspections/roadside">) {
  const me = await requireUser("fleet.view");
  const editable = can(me.role, "fleet.edit");
  const f = await getFormat();
  const sp = await searchParams;
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS);

  const q = one(sp.q);
  const level = Number(one(sp.level));
  const result = one(sp.result);
  const status = one(sp.status);
  const overdue = one(sp.overdue) === "1";
  const unit = one(sp.unit);

  const and: Prisma.RoadsideInspectionWhereInput[] = [];
  if ((INSPECTION_LEVELS as readonly number[]).includes(level)) and.push({ level });
  if (result && (ROADSIDE_RESULTS as readonly string[]).includes(result)) and.push({ result });
  if (status && (ROADSIDE_STATUSES as readonly string[]).includes(status)) and.push({ status });
  if (overdue) and.push({ status: "OPEN", correctionDueAt: { lt: now } });
  if (unit) and.push({ OR: [{ truckId: unit }, { trailerId: unit }, { driverId: unit }] });
  if (q) {
    const like = { contains: q, mode: "insensitive" as const };
    and.push({
      OR: [
        { reportNumber: like }, { location: like }, { state: like }, { notes: like },
        { driver: { name: like } }, { truck: { unitNumber: like } }, { trailer: { unitNumber: like } },
        { violations: { some: { OR: [{ code: like }, { description: like }] } } },
      ],
    });
  }
  const where: Prisma.RoadsideInspectionWhereInput = and.length ? { AND: and } : {};

  const [rows, open, overdueCount, yearTotal, yearOos, yearClean] = await Promise.all([
    db.roadsideInspection.findMany({
      where, take: PAGE, orderBy: { inspectedAt: "desc" },
      include: {
        driver: { select: { id: true, name: true } },
        truck: { select: { id: true, unitNumber: true } },
        trailer: { select: { id: true, unitNumber: true } },
        violations: { select: { oos: true, correctedAt: true } },
      },
    }),
    db.roadsideInspection.count({ where: { status: "OPEN" } }),
    db.roadsideInspection.count({ where: { status: "OPEN", correctionDueAt: { lt: now } } }),
    db.roadsideInspection.count({ where: { inspectedAt: { gte: yearAgo } } }),
    db.roadsideInspection.count({ where: { inspectedAt: { gte: yearAgo }, result: "OOS" } }),
    db.roadsideInspection.count({ where: { inspectedAt: { gte: yearAgo }, result: "CLEAN" } }),
  ]);
  const filtered = and.length > 0;

  return (
    <>
      <PageHeader
        title="Roadside inspections"
        subtitle="DOT roadside inspections, their violations and the corrections they need"
        actions={editable && <LinkButton href="/inspections/roadside/new"><Plus />Log an inspection</LinkButton>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={roadsideHref({ status: "OPEN" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Open" value={open} tone={open ? "warn" : "ok"} icon={<TriangleAlert />} hint={open ? "Something still to correct or certify" : "Nothing waiting on a correction"} />
        </Link>
        <Link href={roadsideHref({ overdue: "1" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Correction overdue" value={overdueCount} tone={overdueCount ? "danger" : "ok"} icon={<Clock />} hint={overdueCount ? "Past the correction due date" : "No correction past its date"} />
        </Link>
        <Link href={roadsideHref({ result: "OOS" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Out of service · 12 months" value={yearOos} tone={yearOos ? "warn" : "ok"} icon={<ShieldAlert />} hint={`${yearTotal} inspections in the last 12 months`} />
        </Link>
        <Link href={roadsideHref({ result: "CLEAN" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Clean · 12 months" value={yearTotal ? `${Math.round((yearClean / yearTotal) * 100)}%` : "—"} icon={<ShieldCheck />}
            hint={yearTotal ? `${yearClean} of ${yearTotal} without a violation` : "No inspections in the last 12 months"} />
        </Link>
      </div>

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <ListFilters
            search={{ placeholder: "Search inspections…", title: "Report number, location, state, driver, unit, violation code or text" }}
            toggles={[{ name: "overdue", label: "Correction overdue", icon: <Clock />, title: "Open and past the correction due date" }]}
            selects={[
              { name: "level", label: "Level", options: INSPECTION_LEVELS.map((l) => ({ value: String(l), label: INSPECTION_LEVEL_LABELS[l] })) },
              { name: "result", label: "Result", options: ROADSIDE_RESULTS.map((r) => ({ value: r, label: roadsideResultLabel(r) })) },
              { name: "status", label: "Status", options: ROADSIDE_STATUSES.map((s) => ({ value: s, label: roadsideStatusLabel(s) })) },
            ]} />
        </div>
        <Table head={["Inspection", "Driver", "Truck / trailer", "Level", "Violations", "OOS", "Correction due", "Status", ""]} empty={rows.length === 0}
          emptyTitle={filtered ? "Nothing matches" : "No roadside inspections yet"}
          emptyDescription={filtered ? "Clear a filter or the search." : editable ? "Log each DOT roadside inspection here, clean ones too: they count toward the fleet's record." : "Roadside inspections will show here once someone logs them."}>
          {rows.map((r) => {
            const oos = r.violations.filter((v) => v.oos).length;
            const left = r.violations.filter((v) => !v.correctedAt).length;
            const late = r.status === "OPEN" && r.correctionDueAt != null && r.correctionDueAt.getTime() < now.getTime();
            const href = `/inspections/roadside/${r.id}`;
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <Link href={href} className="num font-medium text-fg hover:underline">{f.date(r.inspectedAt)}</Link>
                  <div className="num text-[11px] text-fg-subtle">{r.reportNumber ?? "No report number"}{r.state ? ` · ${r.state}` : ""}</div>
                </td>
                <td className="max-w-44 truncate">{r.driver ? <Link href={`/drivers/${r.driver.id}`} className="hover:underline">{r.driver.name}</Link> : <span className="text-fg-faint">—</span>}</td>
                <td className="whitespace-nowrap">
                  {r.truck ? <Link href={`/fleet/${r.truck.id}`} className="num hover:underline">{r.truck.unitNumber}</Link> : <span className="text-fg-faint">—</span>}
                  {r.trailer && <span className="text-fg-muted"> / <Link href={`/fleet/trailers/${r.trailer.id}`} className="num hover:underline">{r.trailer.unitNumber}</Link></span>}
                </td>
                <td className="whitespace-nowrap text-fg-muted" title={INSPECTION_LEVEL_LABELS[r.level]}>{levelShort(r.level)}</td>
                <td className="num">
                  {r.violations.length ? <span className="font-medium text-fg">{r.violations.length}</span> : <Badge value="CLEAN" label="Clean" tone={ROADSIDE_RESULT_TONE.CLEAN} />}
                  {r.violations.length > 0 && left < r.violations.length && <span className="text-[11px] text-fg-subtle"> · {r.violations.length - left} corrected</span>}
                </td>
                <td>{oos ? <Chip tone="danger">{oos} OOS</Chip> : <span className="text-fg-faint">—</span>}</td>
                <td className={cn("num whitespace-nowrap", late ? "font-medium text-danger" : "text-fg-muted")}>
                  {r.correctionDueAt ? `${f.date(r.correctionDueAt)}${late ? " · overdue" : ""}` : <span className="text-fg-faint">—</span>}
                </td>
                <td><Badge value={r.status} label={roadsideStatusLabel(r.status)} tone={ROADSIDE_STATUS_TONE[r.status]} dot /></td>
                <td className="text-right"><LinkButton href={href} size="sm" variant={editable && r.status === "OPEN" && left ? "secondary" : "ghost"}>{editable && r.status === "OPEN" && left ? "Correct" : "View"}</LinkButton></td>
              </tr>
            );
          })}
        </Table>
        {rows.length >= PAGE && <p className="border-t border-line bg-info-soft px-4 py-2 text-[12px] text-info">Showing the newest {PAGE}. Narrow the filters to see older ones.</p>}
      </Card>
    </>
  );
}
