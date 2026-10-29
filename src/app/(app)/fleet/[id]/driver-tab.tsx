import Link from "next/link";
import { CalendarDays, ChevronRight, History, IdCard, Package, Phone, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { DRIVER_TYPE_LABELS } from "@/lib/constants";
import { daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { handoverName, parseHandover, type HandoverItem } from "@/lib/handover";
import { Avatar, Badge, Card, Chip, DL, EmptyState, ExpiryBadge, LinkButton, Table, cn } from "@/components/ui";
import { clearance, EMPLOYMENT_LABELS, scoreGrade } from "../../drivers/shared";
import { DriverActions, EditStintButton, type DriverOption, type StintView } from "./driver-dialogs";

const DAY = 86_400_000;

/**
 * The truck's Driver tab: who drives it now (since when, what went with the unit, pickup photos), the driver's papers
 * at a glance, and every driver who had it before (DriverAssignment, src/lib/assignments.ts).
 */
export async function DriverTab({ truckId, unit, editable }: { truckId: string; unit: string; editable: boolean }) {
  const f = await getFormat();
  const [stints, drivers] = await Promise.all([
    db.driverAssignment.findMany({
      where: { truckId },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      include: {
        driver: {
          select: {
            id: true, name: true, phone: true, status: true, type: true, hold: true, holdReason: true, dispatcher: true, score: true,
            licenseNumber: true, licenseClass: true, licenseExpiry: true, medicalExpiry: true,
          },
        },
        createdBy: { select: { name: true } },
        endedBy: { select: { name: true } },
        documents: { where: { kind: "PHOTO" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
      },
    }),
    editable
      ? db.driver.findMany({
        where: { status: { not: "INACTIVE" } }, orderBy: { name: "asc" },
        select: { id: true, name: true, status: true, hold: true, truck: { select: { id: true, unitNumber: true } } },
      })
      : Promise.resolve([]),
  ]);
  const current = stints.find((s) => !s.endedAt) ?? null;
  const today = f.dateInput(new Date());
  const path = `/fleet/${truckId}`;
  const view = (s: (typeof stints)[number]): StintView => ({
    id: s.id, driverName: s.driver.name, startedAt: f.dateInput(s.startedAt), endedAt: s.endedAt ? f.dateInput(s.endedAt) : null,
    handover: parseHandover(s.handover), note: s.note, endNote: s.endNote, photos: s.documents,
  });
  const options: DriverOption[] = drivers
    .filter((d) => d.id !== current?.driverId)
    .map((d) => ({ id: d.id, name: d.name, status: d.status, hold: d.hold, truck: d.truck && d.truck.id !== truckId ? d.truck.unitNumber : null }));
  const days = (s: { startedAt: Date; endedAt: Date | null }) => Math.max(1, Math.round(((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / DAY));
  const since = (s: { startedAt: Date; backfilled: boolean }) => `${s.backfilled ? "about " : ""}${f.date(s.startedAt)}`;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {/* min-w-0: the history table scrolls inside its card instead of widening the page on a phone. */}
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <Card title="Assigned driver" icon={<UserRound />}
          actions={editable && <DriverActions truckId={truckId} unit={unit} today={today} current={current ? view(current) : null} drivers={options} path={path} />}>
          {current ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={current.driver.name} size={36} />
                  <div className="min-w-0">
                    <Link href={`/drivers/${current.driver.id}`} className="block truncate text-[14px] font-semibold text-fg hover:underline">{current.driver.name}</Link>
                    <p className="truncate text-[12px] text-fg-subtle">
                      {DRIVER_TYPE_LABELS[current.driver.type] ?? current.driver.type} · in unit <span className="num text-fg-muted">{unit}</span>
                      {current.driver.dispatcher && <> · dispatch {current.driver.dispatcher}</>}
                    </p>
                  </div>
                </div>
                <LinkButton href={`/drivers/${current.driver.id}`} variant="secondary" size="sm" className="shrink-0">Driver profile<ChevronRight /></LinkButton>
              </div>
              <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
                <Fact icon={<CalendarDays />} label="Assigned on">
                  <p className="text-[13px] font-medium text-fg">{since(current)} <span className="font-normal text-fg-subtle">· {days(current)} day{days(current) === 1 ? "" : "s"}</span></p>
                  <p className="text-[11px] text-fg-subtle">
                    {current.backfilled
                      ? "Driving it when driver history started; Edit sets the real day."
                      : `by ${current.createdBy?.name ?? "someone no longer here"} · ${f.dateTime(current.createdAt)}`}
                  </p>
                </Fact>
                <Fact icon={<Package />} label="Handed over with the unit">
                  <HandoverList items={parseHandover(current.handover)} />
                </Fact>
              </div>
              {current.documents.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">Pickup photos</p>
                  <PhotoStrip photos={current.documents} />
                </div>
              )}
              {current.note && <p className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-[13px] text-fg">{current.note}</p>}
            </div>
          ) : (
            <EmptyState icon={<UserRound />} title={`No driver on ${unit}`}
              description={editable ? "Assign one to start its stint: the date, what goes with the unit and pickup photos." : "Nobody drives this truck right now."} />
          )}
        </Card>

        <Card title={<span className="flex items-center gap-1.5">Driver history{stints.length > 0 && <span className="num text-[12px] font-normal text-fg-subtle">{stints.length}</span>}</span>} icon={<History />} flush>
          <Table dense stickyHead={false} head={["Driver", "From", "To", "Days", "Handed over", "Photos", "Notes", ...(editable ? [""] : [])]}
            empty={stints.length === 0} emptyTitle="No drivers recorded yet" emptyDescription="Every driver this truck gets is kept here, with the days they had it.">
            {stints.map((s) => {
              const handover = parseHandover(s.handover);
              return (
                <tr key={s.id} className={cn(!s.endedAt && "bg-accent-soft/30")}>
                  <td className="whitespace-nowrap">
                    <Link href={`/drivers/${s.driver.id}`} className="font-medium text-fg hover:underline">{s.driver.name}</Link>
                    {!s.endedAt && <Badge value="ACTIVE" label="Now" className="ml-2" />}
                  </td>
                  <td className="num whitespace-nowrap text-fg-muted" title={s.backfilled ? "Best guess: the driver had the truck when history started" : `Recorded by ${s.createdBy?.name ?? "—"}`}>{since(s)}</td>
                  <td className="num whitespace-nowrap text-fg-muted" title={s.endedAt ? `Closed by ${s.endedBy?.name ?? "—"}` : undefined}>{s.endedAt ? f.date(s.endedAt) : <span className="text-fg-subtle">still driving</span>}</td>
                  <td className="num text-fg-muted">{days(s)}</td>
                  <td className="max-w-56"><span className="block truncate text-[12px] text-fg-muted" title={handover.map(itemText).join(", ")}>{handover.length ? handover.map(handoverName).join(", ") : "—"}</span></td>
                  <td className="whitespace-nowrap text-[12px]">
                    {s.documents.length
                      ? <a href={`/api/documents/${s.documents[0].id}`} target="_blank" rel="noreferrer" className="text-fg-muted hover:underline">{s.documents.length} photo{s.documents.length === 1 ? "" : "s"}</a>
                      : <span className="text-fg-faint">—</span>}
                  </td>
                  <td className="max-w-64"><span className="block truncate text-[12px] text-fg-muted" title={[s.note, s.endNote].filter(Boolean).join(" · ") || undefined}>{[s.note, s.endNote].filter(Boolean).join(" · ") || "—"}</span></td>
                  {editable && <td className="w-8 text-right"><EditStintButton unit={unit} today={today} stint={view(s)} path={path} /></td>}
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <DriverInfo driver={current?.driver ?? null} f={f} />
      </div>
    </div>
  );
}

type InfoDriver = {
  id: string; name: string; phone: string | null; status: string; hold: boolean; holdReason: string | null; score: number;
  licenseNumber: string; licenseClass: string; licenseExpiry: Date; medicalExpiry: Date | null;
};

function DriverInfo({ driver, f }: { driver: InfoDriver | null; f: Awaited<ReturnType<typeof getFormat>> }) {
  if (!driver) {
    return (
      <Card title="Driver information" icon={<IdCard />}>
        <p className="text-[13px] text-fg-muted">The driver&apos;s licence, medical card and safety score show here once the truck has one.</p>
      </Card>
    );
  }
  const clear = clearance(driver);
  const grade = scoreGrade(driver.score);
  return (
    <Card title="Driver information" icon={<IdCard />}
      actions={<Link href={`/drivers/${driver.id}`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Profile →</Link>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge value={clear.label} tone={clear.tone} label={clear.cleared ? "Cleared to drive" : clear.label} dot />
        {clear.detail && <span className="text-[12px] text-fg-muted">{clear.detail}</span>}
      </div>
      <DL cols={1} items={[
        ["Phone", driver.phone ? <a key="p" href={`tel:${driver.phone}`} className="num inline-flex items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5 text-fg-subtle" />{driver.phone}</a> : "—"],
        ["Licence", <span key="l" className="inline-flex flex-wrap items-center gap-2"><span className="num">{driver.licenseNumber} · {driver.licenseClass}</span><span className="num text-fg-subtle">{f.date(driver.licenseExpiry)}</span><ExpiryBadge days={daysUntil(driver.licenseExpiry)} /></span>],
        ["Medical card", driver.medicalExpiry
          ? <span key="m" className="inline-flex items-center gap-2"><span className="num text-fg-subtle">{f.date(driver.medicalExpiry)}</span><ExpiryBadge days={daysUntil(driver.medicalExpiry)} /></span>
          : <span key="m" className="text-warn">Not recorded</span>],
        ["Safety score", <Badge key="s" value={grade.grade} tone={grade.tone} label={`${grade.grade} · ${driver.score}`} className="num" />],
        ["Employment", <span key="e">{EMPLOYMENT_LABELS[driver.status] ?? driver.status}{driver.hold ? <Chip tone="warn" className="ml-2">Hold</Chip> : null}</span>],
      ]} />
    </Card>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] text-fg-subtle [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}{label}</p>
      {children}
    </div>
  );
}

const itemText = (h: HandoverItem) => `${handoverName(h)}${h.ref ? ` (${h.ref})` : ""}`;

function HandoverList({ items }: { items: HandoverItem[] }) {
  if (!items.length) return <p className="text-[13px] text-fg-muted">Nothing recorded</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((h) => (
        <li key={`${h.item}-${h.label ?? ""}`}>
          <Chip className="normal-case tracking-normal" title={h.ref ?? undefined}>{handoverName(h)}{h.ref && <span className="num ml-1 text-fg-subtle">{h.ref}</span>}</Chip>
        </li>
      ))}
    </ul>
  );
}

function PhotoStrip({ photos }: { photos: { id: string; name: string }[] }) {
  return (
    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {photos.map((p) => (
        <li key={p.id}>
          <a href={`/api/documents/${p.id}`} target="_blank" rel="noreferrer" title={p.name}
            className="block aspect-square overflow-hidden rounded-md border border-line bg-sunken transition-opacity hover:opacity-85">
            {/* eslint-disable-next-line @next/next/no-img-element -- served through the permission-checked document route */}
            <img src={`/api/documents/${p.id}`} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}
