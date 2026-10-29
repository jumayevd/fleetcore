import { PrismaClient, type Driver, type Prisma, type Trailer, type Truck } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CITIES, DEFECT_DUE_DAYS, PTI_COMPONENTS, nearestCity } from "../src/lib/constants";
import { dateOnly, weekStartIn, type CompanyLocale } from "../src/lib/locale";

/*
 * Demo data for FleetCore: two US fleets (miles, gallons, US time zones) and one metric fleet in Uzbekistan, worked by
 * one fleet specialist (Aziza) with two different logins, plus an open invitation to a fourth company. Every row
 * carries its companyId explicitly (this script uses the unscoped client).
 *
 * Every number is stored in the company's own units (see src/lib/locale.ts): odometers in miles for the US fleets.
 * Names, vendors, phone numbers (555-01xx), report and DOT numbers are made up.
 */

const db = new PrismaClient();

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const ahead = (days: number) => new Date(now + days * DAY);
const city = (n: string) => {
  const c = CITIES.find((x) => x.name === n);
  if (!c) throw new Error(`Unknown city ${n}`);
  return c;
};
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";

// Deterministic PRNG so the demo looks the same every reseed (re-seeded per company).
let s = 42;
const reseed = (n: number) => { s = n; };
const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;
const round2 = (n: number) => Math.round(n * 100) / 100;
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const vin = (prefix: string) => (prefix + Array.from({ length: 17 }, () => pick(VIN_CHARS.split(""))).join("")).slice(0, 17);

type VendorSpec = { name: string; type: string; city: string; phone: string; contactName?: string; email?: string; address?: string };
type CompanySpec = {
  name: string; color: string; seed: number; locale: CompanyLocale;
  truckPrefix: string; firstUnit: number; trailerPrefix: string; firstTrailer: number;
  trucks: number; trailers: number;
  homes: string[]; routes: string[];
  plate: () => string; trailerPlate: () => string; phone: () => string; license: () => string; licenseClass: string;
  drivers: string[]; dispatchers: string[];
  /** make, model, truck type name (null = no type: the truck's own interval applies) */
  models: [string, string, string | null, string][];
  truckTypes: [string, number][];
  ownInterval: number;
  vendors: VendorSpec[];
  /** Free-text shop names on old repairs that match no vendor (the vendors page offers to tidy them up). */
  legacyVendors: string[];
  stations: string[]; lessor: string;
  fuelPrice: [number, number]; economy: [number, number]; odo: [number, number]; daily: [number, number];
  tanks: number[]; trailerTypes: string[]; capacity: Record<string, number>; speed: [number, number];
  leaseLimit: number; leaseRate: number;
  states: string[]; roadside: boolean;
  technicians: string[];
  profile: Record<string, unknown>;
  companyDocs: [string, string, number | null][];
};

/* ------------------------------------------------------------------ */
/* Repair catalogue (amounts in the company currency)                  */
/* ------------------------------------------------------------------ */

type Job = { type: string; category: string; title: string; lines: [string, string, number][]; vendorType: string[] };
const OIL: Job = {
  type: "OIL_CHANGE", category: "PM", title: "Oil change & filters", vendorType: ["SHOP", "DEALER"],
  lines: [["PM", "Engine oil & oil filter", 285], ["PM", "Fuel filters & air filter check", 145], ["FEES", "Shop supplies & disposal", 35]],
};
const DOT: Job = {
  type: "DOT_INSPECTION", category: "INSPECTION", title: "Annual DOT inspection", vendorType: ["SHOP", "DEALER"],
  lines: [["OTHER", "Annual inspection & sticker", 120], ["ELECTRICAL", "Replace marker lamp", 45]],
};
const JOBS: Job[] = [
  { type: "TIRES", category: "TIRES", title: "Replace 2 steer tires", vendorType: ["TIRE"], lines: [["TIRES", "Steer tires 295/75R22.5 ×2", 1180], ["TIRES", "Mount, balance & alignment", 240]] },
  { type: "REPAIR", category: "BRAKES", title: "Drive axle brake job", vendorType: ["SHOP"], lines: [["BRAKES", "Shoes, drums & hardware", 1450], ["BRAKES", "Slack adjusters ×4", 380], ["FEES", "Labor 6 h", 720]] },
  { type: "ENGINE", category: "ENGINE", title: "Air compressor replacement", vendorType: ["DEALER", "SHOP"], lines: [["ENGINE", "Air compressor (reman)", 1650], ["ENGINE", "Labor 4.5 h", 540]] },
  { type: "DPF", category: "ENGINE", title: "DPF clean & NOx sensor", vendorType: ["DEALER"], lines: [["EXHAUST", "DPF clean & bake", 650], ["EXHAUST", "NOx sensor (outlet)", 520], ["FEES", "Diagnostics", 150]] },
  { type: "ELECTRICAL", category: "ELECTRICAL", title: "Alternator replacement", vendorType: ["SHOP", "MOBILE"], lines: [["ELECTRICAL", "Alternator 160 A", 690], ["ELECTRICAL", "Labor 2 h", 240]] },
  { type: "REPAIR", category: "COOLING", title: "Radiator hose & coolant", vendorType: ["SHOP", "MOBILE"], lines: [["COOLING", "Upper radiator hose & clamps", 210], ["COOLING", "Coolant top-up", 85]] },
  { type: "REPAIR", category: "OTHER", title: "A/C not cooling", vendorType: ["SHOP"], lines: [["HVAC", "A/C compressor", 980], ["HVAC", "Evacuate & recharge", 180]] },
  { type: "STEER", category: "OTHER", title: "Steering gear replacement", vendorType: ["DEALER", "SHOP"], lines: [["SUSPENSION", "Steering gear (reman)", 1350], ["SUSPENSION", "Alignment", 180]] },
  { type: "BODY", category: "BODY", title: "Mirror & step repair", vendorType: ["SHOP"], lines: [["BODY", "Passenger mirror assembly", 420], ["BODY", "Step bracket weld", 160]] },
  { type: "REPAIR", category: "BRAKES", title: "Air leak — brake chamber", vendorType: ["MOBILE", "SHOP"], lines: [["BRAKES", "Brake chamber 30/30", 145], ["FEES", "Road call", 225]] },
];
const INJECTORS: Job = { type: "INJECTOR", category: "ENGINE", title: "Injectors ×6 (warranty)", vendorType: ["DEALER"], lines: [["ENGINE", "Injectors ×6", 3200], ["ENGINE", "Labor 7 h", 980]] };

const seedKey = (companyId: string, scope: string, name: string) => `seed/${companyId}/${scope}/${name.replace(/[^\w.-]+/g, "_")}.pdf`;

/* ------------------------------------------------------------------ */
/* One company                                                         */
/* ------------------------------------------------------------------ */

async function seedCompany(spec: CompanySpec, people: { owner: string; members: { userId: string; role: string; lastActiveDays?: number }[] }) {
  reseed(spec.seed);
  const imperial = spec.locale.units === "imperial";
  const company = await db.company.create({
    data: { name: spec.name, color: spec.color, ...spec.locale, createdAt: ago(int(200, 400)) },
  });
  const companyId = company.id;
  for (const m of [{ userId: people.owner, role: "OWNER" }, ...people.members]) {
    await db.membership.create({
      data: { companyId, userId: m.userId, role: m.role, createdAt: ago(int(30, 190)), lastActiveAt: "lastActiveDays" in m && m.lastActiveDays != null ? ago(m.lastActiveDays) : ago(between(0.2, 9)) },
    });
  }
  const specialist = people.members.find((m) => m.role === "SPECIALIST")?.userId ?? people.owner;
  const reviewer = people.members.find((m) => m.role === "SPECIALIST" && m.userId !== specialist)?.userId ?? specialist;

  // ---------- Truck types & vendors ----------
  const types = new Map<string, { id: string; oilIntervalKm: number }>();
  for (const [name, interval] of spec.truckTypes) {
    types.set(name, await db.truckType.create({ data: { companyId, name, oilIntervalKm: interval } }));
  }
  const vendors: { id: string; name: string; type: string }[] = [];
  for (const v of spec.vendors) {
    vendors.push(await db.vendor.create({
      data: { companyId, name: v.name, type: v.type, city: v.city, phone: v.phone, contactName: v.contactName ?? null, email: v.email ?? null, address: v.address ?? null, createdAt: ago(int(100, 300)) },
    }));
  }
  const vendorFor = (kinds: string[]) => {
    const fit = vendors.filter((v) => kinds.includes(v.type));
    return fit.length ? pick(fit) : pick(vendors);
  };

  // ---------- Drivers ----------
  const drivers: Driver[] = [];
  for (const [i, name] of spec.drivers.entries()) {
    const type = i === spec.drivers.length - 1 ? "LEASE" : i % 5 === 0 ? "OWNER_OPERATOR" : "COMPANY";
    drivers.push(await db.driver.create({
      data: {
        companyId, name, type,
        email: chance(0.6) ? `${name.split(" ")[0].toLowerCase()}@${spec.name.toLowerCase().replace(/[^a-z]+/g, "")}.example` : null,
        phone: spec.phone(),
        phone2: chance(0.3) ? spec.phone() : null,
        licenseNumber: spec.license(),
        licenseClass: spec.licenseClass,
        // A couple expiring or expired so alerts show up.
        licenseExpiry: ahead(i === 3 ? 12 : i === 6 ? -5 : int(120, 1400)),
        medicalExpiry: ahead(i === 4 ? 20 : int(60, 700)),
        hireDate: ago(int(90, 2400)),
        score: i === 6 ? 62 : i === 2 ? 78 : int(84, 100),
        status: i === spec.drivers.length - 2 ? "ON_LEAVE" : "ACTIVE",
        hold: i === 6, holdReason: i === 6 ? "Licence expired — renewal pending" : null,
        dispatcher: spec.dispatchers[i % spec.dispatchers.length],
        createdAt: ago(int(60, 300)),
      },
    }));
  }
  const assignable = drivers.filter((d) => d.status === "ACTIVE" && !d.hold);

  // ---------- Trucks ----------
  // Distance left to the next oil change, per truck (negative = overdue). Scaled for km fleets.
  const LEFT = [-2600, 1800, 650, -400, 2400, 7200, 11800, 4300, 900, 13400, 9100, 5600, 2900, 12100, 8000, 10500];
  const scale = imperial ? 1 : 1.6;
  const n = spec.trucks;
  const IN_SHOP = [n - 3, n - 2];
  const INACTIVE = n - 1;
  const OOS = 3;
  type T = Truck & { daily: number; interval: number };
  const trucks: T[] = [];
  let nextDriver = 0;
  for (let i = 0; i < n; i++) {
    const [make, model, typeName, vinPrefix] = spec.models[(i + spec.seed) % spec.models.length];
    const type = i === 5 ? null : typeName ? types.get(typeName) ?? null : null;
    const interval = type?.oilIntervalKm ?? spec.ownInterval;
    const home = city(spec.homes[i % spec.homes.length]);
    const odo = int(spec.odo[0], spec.odo[1]);
    const status = i === INACTIVE ? "INACTIVE" : IN_SHOP.includes(i) ? "MAINTENANCE" : i === OOS ? "OUT_OF_SERVICE" : "ACTIVE";
    const daily = status === "ACTIVE" ? int(spec.daily[0], spec.daily[1]) : int(Math.round(spec.daily[0] / 4), Math.round(spec.daily[0] / 2));
    const left = Math.round(LEFT[i % LEFT.length] * scale);
    const lastPmKm = Math.max(1000, odo - (interval - left));
    const stale = i % 7 === 5; // no fresh odometer reading: the oil board shows "no recent reading"
    const odometerAt = status === "INACTIVE" ? ago(int(70, 110)) : stale ? ago(int(18, 40)) : ago(between(0.05, 2));
    const leased = i === 2 || i === 6;
    const rolling = status === "ACTIVE" && chance(0.5);
    const dest = city(pick(spec.routes));
    const t = rolling ? between(0.2, 0.8) : 0;
    const lat = rolling ? home.lat + (dest.lat - home.lat) * t : home.lat + between(-0.03, 0.03);
    const lng = rolling ? home.lng + (dest.lng - home.lng) * t : home.lng + between(-0.03, 0.03);
    const quiet = status === "ACTIVE" && !rolling && i % 6 === 4; // a tracker that went quiet
    const driver = status !== "INACTIVE" && nextDriver < assignable.length ? assignable[nextDriver++] : null;
    const inspectionExpiry = ahead(i === 4 ? 18 : i === 9 ? 26 : i === 10 ? -4 : int(40, 330));
    const truck = await db.truck.create({
      data: {
        companyId,
        unitNumber: `${spec.truckPrefix}${spec.firstUnit + i}`,
        make, model, year: int(2016, 2025),
        vin: vin(vinPrefix),
        plate: imperial && i === 7 ? "" : spec.plate(),
        status,
        ownership: leased ? "LEASED" : i % 5 === 4 ? "OWNER_OPERATOR" : "COMPANY",
        group: spec.homes[i % spec.homes.length].split(",")[0],
        homeTerminal: spec.homes[i % spec.homes.length],
        color: pick(["White", "White", "Black", "Red", "Blue", "Silver", "Burgundy"]),
        engineHours: Math.round(odo / (imperial ? 38 : 60)),
        inServiceAt: i === 6 ? null : ago(int(200, 1800)),
        lessor: leased ? spec.lessor : null,
        leaseStartKm: leased ? odo - Math.round((i === 6 ? 128_000 : 70_000) * (imperial ? 0.75 : 1)) : null,
        leaseAnnualLimitKm: leased ? spec.leaseLimit : null,
        leaseBufferPct: leased ? 5 : null,
        leaseOverageRate: leased ? spec.leaseRate : null,
        odometerKm: odo, odometerAt,
        truckTypeId: type?.id ?? null,
        pmIntervalKm: spec.ownInterval,
        lastPmKm, lastPmAt: ago(Math.min(170, Math.max(3, Math.round((odo - lastPmKm) / Math.max(1, daily))))),
        nextServiceKm: lastPmKm + interval,
        // Where it goes for oil changes, as a specialist would type it on the oil board (about half the trucks).
        oilShop: i % 2 === 0 ? (() => { const v = spec.vendors.find((x) => x.type === "SHOP" || x.type === "DEALER"); return v ? `${v.name}${v.address ? `, ${v.address}` : ""}, ${v.city}` : null; })() : null,
        fuelCapacityL: pick(spec.tanks),
        insuranceExpiry: ahead(i === 1 ? 9 : int(40, 360)),
        inspectionExpiry,
        registrationExpiry: ahead(i === 8 ? -6 : int(60, 700)),
        lat, lng, locationName: nearestCity(lat, lng, spec.locale.units).label,
        speedKmh: rolling ? int(spec.speed[0], spec.speed[1]) : 0,
        heading: rolling ? int(0, 359) : 0,
        engineOn: rolling || chance(0.15),
        fuelPct: int(rolling ? 18 : 30, 95),
        fuelEconomy: Math.round(between(spec.economy[0], spec.economy[1]) * 10) / 10,
        lastPingAt: status === "INACTIVE" ? ago(int(60, 90)) : quiet ? ago(int(3, 6)) : new Date(now - int(1, rolling ? 4 : 50) * 60_000),
        pingSource: i % 3 === 0 ? "SAMSARA" : "DEVICE",
        driverId: driver?.id ?? null,
        createdAt: ago(int(120, 400)),
      },
    });
    trucks.push({ ...truck, daily, interval });
  }
  // ---------- Driver history ----------
  // Every truck with a driver has the stint that began when the driver took it; every third truck had someone before.
  for (const [i, t] of trucks.entries()) {
    if (!t.driverId) continue;
    const start = ago(int(12, 160));
    const before = drivers[(i + 5) % drivers.length];
    if (i % 3 === 0 && before.id !== t.driverId) {
      const from = new Date(start.getTime() - int(60, 300) * DAY);
      await db.driverAssignment.create({
        data: {
          companyId, truckId: t.id, driverId: before.id, startedAt: from, endedAt: start, createdById: specialist, endedById: specialist, createdAt: from,
          handover: [{ item: "KEYS" }, { item: "FUEL_CARD", ref: `FC-${int(1000, 9999)}` }], endNote: "Keys and fuel card back",
        },
      });
    }
    await db.driverAssignment.create({
      data: {
        companyId, truckId: t.id, driverId: t.driverId, startedAt: start, createdById: specialist, createdAt: start,
        handover: [{ item: "KEYS" }, { item: "ELD", ref: `ELD-${int(10000, 99999)}` }, ...(i % 2 ? [{ item: "TOLL_TAG", ref: `TT${int(100000, 999999)}` }] : [])],
        note: i % 4 === 0 ? "Small dent on the right step, noted at pickup" : null,
      },
    });
  }

  const odoAt = (t: T, daysAgo: number) => Math.max(0, Math.round(t.odometerKm - t.daily * daysAgo - between(0, 40)));
  const truckAt = (i: number) => trucks[i] as T | undefined;

  // ---------- Trailers ----------
  const trailers: Trailer[] = [];
  const pairable = trucks.filter((t) => t.status === "ACTIVE");
  for (let i = 0; i < spec.trailers; i++) {
    const type = spec.trailerTypes[i % spec.trailerTypes.length];
    const yard = city(spec.homes[0]);
    const status = i === spec.trailers - 1 ? "SHOP" : i === spec.trailers - 2 ? "OUT_OF_SERVICE"
      : i < Math.min(pairable.length, Math.ceil(spec.trailers / 2)) ? "IN_USE" : i % 3 === 0 ? "DROPPED" : "YARD";
    const pairedTruck = status === "IN_USE" ? pairable[i] : null;
    const dropCity = city(pick(spec.routes));
    const at = pairedTruck ? { lat: pairedTruck.lat!, lng: pairedTruck.lng! } : status === "DROPPED" ? dropCity : yard;
    trailers.push(await db.trailer.create({
      data: {
        companyId,
        unitNumber: `${spec.trailerPrefix}${spec.firstTrailer + i}`, type, year: int(2014, 2024),
        capacityKg: spec.capacity[type] ?? spec.capacity.DRY_VAN,
        plate: spec.trailerPlate(),
        status, statusSince: ago(status === "SHOP" ? 10 : status === "DROPPED" ? int(2, 6) : int(0, 20)),
        truckId: pairedTruck?.id ?? null,
        lat: at.lat + between(-0.02, 0.02), lng: at.lng + between(-0.02, 0.02),
        locationName: pairedTruck ? pairedTruck.locationName : status === "DROPPED" ? `${dropCity.name.split(",")[0]} customer yard` : status === "SHOP" ? vendors[0].name : `${yard.name.split(",")[0]} yard`,
        gpsProvider: i < spec.trailers - 3 ? pick(["Teltonika", "SkyBitz"]) : null,
        lastPingAt: i < spec.trailers - 3 ? new Date(now - int(5, 600) * 60_000) : null,
        insuranceExpiry: ahead(int(30, 500)),
        inspectionExpiry: ahead(i === 2 ? 14 : int(30, 500)),
        createdAt: ago(int(120, 400)),
      },
    }));
  }

  // ---------- Repair orders ----------
  type Ev = { kind: string; stage?: string; body?: string; at: Date; userId?: string | null };
  type RoInput = Omit<Prisma.WorkOrderUncheckedCreateInput, "number" | "companyId" | "title" | "category" | "repairType" | "cost" | "partsCost" | "laborCost"> & {
    job: Job; title?: string; lines?: [string, string, number][]; events?: Ev[]; withLines?: boolean;
  };
  const roRows: { at: number; input: RoInput }[] = [];
  const queue = (at: Date, input: RoInput) => roRows.push({ at: at.getTime(), input });
  const vendorFields = (job: Job, legacy = false) => {
    if (legacy && spec.legacyVendors.length) return { vendorId: null, vendor: pick(spec.legacyVendors) };
    const v = vendorFor(job.vendorType);
    return { vendorId: v.id, vendor: v.name };
  };

  // History: a few repairs per truck, the oil change that set its last reading, and its last annual inspection.
  for (const [i, t] of trucks.entries()) {
    const jobs = int(1, 3);
    for (let k = 0; k < jobs; k++) {
      const d = int(8, 170);
      const job = pick(JOBS);
      const inAt = ago(d);
      const outAt = new Date(inAt.getTime() + int(4, 60) * HOUR);
      queue(inAt, {
        job, truckId: t.id, status: "DONE", priority: pick(["LOW", "MEDIUM", "MEDIUM", "HIGH"]),
        scheduledAt: inAt, inAt, outAt, completedAt: outAt, odometerKm: odoAt(t, d), odometerOutKm: odoAt(t, d) + int(0, 8),
        technician: pick(spec.technicians), ...vendorFields(job, k === 0 && i % 5 === 1),
        createdById: specialist, createdAt: inAt,
      });
    }
    const pmDays = Math.min(170, Math.max(3, Math.round((t.odometerKm - (t.lastPmKm ?? t.odometerKm)) / Math.max(1, t.daily))));
    const pmAt = ago(pmDays);
    queue(pmAt, {
      job: OIL, truckId: t.id, status: "DONE", priority: "MEDIUM", scheduledAt: pmAt, inAt: pmAt, outAt: new Date(pmAt.getTime() + int(2, 5) * HOUR),
      completedAt: new Date(pmAt.getTime() + int(2, 5) * HOUR), odometerKm: t.lastPmKm, odometerOutKm: t.lastPmKm,
      technician: pick(spec.technicians), ...vendorFields(OIL, i % 6 === 2), createdById: specialist, createdAt: pmAt,
    });
    const dotAt = t.inspectionExpiry ? new Date(t.inspectionExpiry.getTime() - 365 * DAY) : null;
    if (dotAt && dotAt.getTime() > now - 200 * DAY && dotAt.getTime() < now) {
      queue(dotAt, {
        job: DOT, truckId: t.id, status: "DONE", priority: "MEDIUM", scheduledAt: dotAt, inAt: dotAt, outAt: new Date(dotAt.getTime() + 3 * HOUR),
        completedAt: new Date(dotAt.getTime() + 3 * HOUR), odometerKm: odoAt(t, (now - dotAt.getTime()) / DAY), technician: pick(spec.technicians),
        ...vendorFields(DOT), createdById: specialist, createdAt: dotAt,
      });
    }
  }

  // Who pays: two driver charges nobody has told the driver about yet, one they have; a warranty claim; one under investigation.
  const chargeTrucks = trucks.filter((t) => t.driverId && t.status !== "INACTIVE");
  const charges: [number, Job, string, boolean][] = [
    [18, JOBS[8], "Mirror hit at the customer's dock — driver backing in", false],
    [9, JOBS[0], "Steer tire ruined on a curb strike, photos from the driver", false],
    [41, JOBS[9], "Brake chamber damaged by a road-side tow — driver declined the road call", true],
  ];
  for (const [k, [d, job, note, told]] of charges.entries()) {
    const t = chargeTrucks[(k * 3 + 1) % chargeTrucks.length];
    if (!t) continue;
    const at = ago(d);
    const outAt = new Date(at.getTime() + int(3, 20) * HOUR);
    queue(at, {
      job, truckId: t.id, status: "DONE", priority: "MEDIUM", scheduledAt: at, inAt: at, outAt, completedAt: outAt,
      odometerKm: odoAt(t, d), payer: "DRIVER", chargeDriverId: t.driverId, driverInformedAt: told ? new Date(outAt.getTime() + 20 * HOUR) : null,
      technician: pick(spec.technicians), ...vendorFields(job), createdById: specialist, createdAt: at, notes: note,
      events: [{ kind: "NOTE", body: note, at: outAt, userId: specialist }, ...(told ? [{ kind: "DRIVER_INFORMED", body: "Driver told by phone", at: new Date(outAt.getTime() + 20 * HOUR), userId: specialist }] : [])],
    });
  }
  const warrantyTruck = truckAt(9) ?? trucks[1];
  queue(ago(33), {
    job: INJECTORS, truckId: warrantyTruck.id, status: "DONE", priority: "HIGH", scheduledAt: ago(33), inAt: ago(33), outAt: ago(31), completedAt: ago(31),
    odometerKm: odoAt(warrantyTruck, 33), payer: "WARRANTY", technician: pick(spec.technicians), ...vendorFields(INJECTORS),
    createdById: specialist, createdAt: ago(33), notes: "Claim filed with the dealer — engine still under extended warranty.",
  });
  const accidentTruck = truckAt(11) ?? trucks[2];
  queue(ago(22), {
    job: { type: "ACCIDENT", category: "BODY", title: "Front bumper & hood after deer strike", vendorType: ["SHOP"], lines: [["BODY", "Bumper, hood latch, grille", 2380], ["ELECTRICAL", "Headlamp assembly", 410]] },
    truckId: accidentTruck.id, status: "DONE", priority: "HIGH", scheduledAt: ago(22), inAt: ago(22), outAt: ago(18), completedAt: ago(18),
    odometerKm: odoAt(accidentTruck, 22), payer: "INVESTIGATION", technician: pick(spec.technicians), ...vendorFields(JOBS[8]),
    createdById: specialist, createdAt: ago(22), notes: "Safety is reviewing the dash-cam footage before deciding who pays.",
  });
  // A voided duplicate.
  const voidTruck = trucks[0];
  queue(ago(27), {
    job: JOBS[4], truckId: voidTruck.id, status: "CANCELLED", priority: "MEDIUM", scheduledAt: ago(27), voidedAt: ago(26.8), voidReason: "Duplicate — entered twice",
    ...vendorFields(JOBS[4]), createdById: specialist, createdAt: ago(27), withLines: false,
    events: [{ kind: "VOID", body: "Duplicate — entered twice", at: ago(26.8), userId: specialist }],
  });

  // In the shop right now.
  const [shopA, shopB] = IN_SHOP.map((i) => trucks[i]);
  const dealer = vendors.find((v) => v.type === "DEALER") ?? vendors[0];
  const shop = vendors.find((v) => v.type === "SHOP") ?? vendors[0];
  queue(ago(6), {
    job: { type: "ENGINE", category: "ENGINE", title: "Turbo actuator & EGR valve", vendorType: ["DEALER"], lines: [["ENGINE", "VGT actuator", 2650], ["EXHAUST", "EGR valve & gaskets", 1180], ["FEES", "Diagnostics & labor estimate", 1020]] },
    truckId: shopA.id, status: "IN_PROGRESS", priority: "HIGH", scheduledAt: ago(6), inAt: ago(6), promisedAt: ago(1), stage: "WAITING_PARTS", stageAt: ago(2),
    odometerKm: shopA.odometerKm, vendorId: dealer.id, vendor: dealer.name, technician: pick(spec.technicians),
    description: "Derate on the highway, fault codes for the turbo actuator. Dealer also found a sticking EGR valve.",
    createdById: specialist, createdAt: ago(6),
    events: [
      { kind: "STAGE", stage: "DIAGNOSING", at: ago(6), userId: specialist },
      { kind: "STAGE", stage: "WAITING_APPROVAL", body: "Estimate sent: actuator + EGR valve", at: ago(5), userId: specialist },
      { kind: "NOTE", body: "Approved by the owner on the phone.", at: ago(4.6), userId: specialist },
      { kind: "STAGE", stage: "WAITING_PARTS", body: "Actuator back-ordered, ETA from the warehouse in 2–3 days", at: ago(2), userId: specialist },
      { kind: "NOTE", body: "Called the service desk — part ships tonight, install tomorrow morning.", at: ago(0.3), userId: specialist },
    ],
  });
  queue(ago(1.2), {
    job: JOBS[9], title: "Air leak — rear brake chamber & hose", truckId: shopB.id, status: "IN_PROGRESS", priority: "MEDIUM", scheduledAt: ago(1.2), inAt: ago(1.2),
    promisedAt: ahead(1), stage: "WAITING_APPROVAL", stageAt: ago(0.4), odometerKm: shopB.odometerKm, vendorId: shop.id, vendor: shop.name, technician: pick(spec.technicians),
    createdById: specialist, createdAt: ago(1.2),
    events: [
      { kind: "STAGE", stage: "DIAGNOSING", at: ago(1.2), userId: specialist },
      { kind: "STAGE", stage: "WAITING_APPROVAL", body: "Estimate sent — brake chamber, air hose and labor", at: ago(0.4), userId: specialist },
    ],
  });
  const shopTrailer = trailers[trailers.length - 1];
  queue(ago(10), {
    job: { type: "BODY", category: "BODY", title: "Rear door hinge & seal", vendorType: ["SHOP"], lines: [["BODY", "Door hinges ×3 & seal", 260], ["FEES", "Labor 2.5 h", 180]] },
    trailerId: shopTrailer.id, status: "IN_PROGRESS", priority: "MEDIUM", scheduledAt: ago(10), inAt: ago(10), promisedAt: ago(3), stage: "QUALITY_CHECK", stageAt: ago(0.8),
    vendorId: shop.id, vendor: shop.name, createdById: specialist, createdAt: ago(10),
    events: [{ kind: "STAGE", stage: "DIAGNOSING", at: ago(10), userId: specialist }, { kind: "STAGE", stage: "WAITING_PARTS", at: ago(8), userId: specialist }, { kind: "STAGE", stage: "QUALITY_CHECK", at: ago(0.8), userId: specialist }],
  });

  // Booked: the oil change that is due now, the DOT inspection coming up, and the tire for the truck held by a defect.
  const dueNow = truckAt(2) ?? trucks[0];
  queue(ago(0.6), {
    job: OIL, truckId: dueNow.id, status: "OPEN", priority: "MEDIUM", scheduledAt: ahead(2), ...vendorFields(OIL),
    createdById: specialist, createdAt: ago(0.6), withLines: false,
  });
  const dotSoon = truckAt(4);
  if (dotSoon) queue(ago(2), { job: DOT, truckId: dotSoon.id, status: "OPEN", priority: "MEDIUM", scheduledAt: ahead(9), ...vendorFields(DOT), createdById: specialist, createdAt: ago(2), withLines: false });
  const oosTruck = trucks[OOS];
  const tireVendor = vendorFor(["TIRE"]);
  queue(ago(4), {
    job: JOBS[0], title: "Replace cut left steer tire", truckId: oosTruck.id, status: "OPEN", priority: "URGENT", scheduledAt: ahead(0.4),
    vendorId: tireVendor.id, vendor: tireVendor.name, createdById: specialist, createdAt: ago(4), withLines: false,
    notes: "Truck stays parked until the tire is replaced and the walk-around confirms it.",
  });
  queue(ago(1), { job: JOBS[3], title: "Check engine light — aftertreatment", truckId: (truckAt(7) ?? trucks[1]).id, status: "DRAFT", priority: "MEDIUM", scheduledAt: ahead(3), createdById: specialist, createdAt: ago(1), withLines: false });

  // Numbers grow with time.
  roRows.sort((a, b) => a.at - b.at);
  let woNumber = 0;
  const created: { id: string; truckId: string | null; trailerId: string | null; title: string; status: string; repairType: string; outAt: Date | null; invoiceNumber: string | null }[] = [];
  for (const { input } of roRows) {
    const { job, title, lines: linesIn, events = [], withLines = true, ...rest } = input;
    const lines = (linesIn ?? job.lines).map(([system, work, amount]) => [system, work, Math.round(amount * between(0.88, 1.2))] as const);
    const total = withLines ? lines.reduce((a, l) => a + l[2], 0) : 0;
    const done = rest.status === "DONE";
    const recent = done && rest.outAt && new Date(rest.outAt as Date).getTime() > now - 12 * DAY;
    const invoiceNumber = done ? `${pick(["INV", "RO", "W"])}-${int(10000, 99999)}` : null;
    const wo = await db.workOrder.create({
      data: {
        ...rest, companyId, number: ++woNumber,
        title: title ?? job.title, category: job.category, repairType: job.type,
        partsCost: Math.round(total * 0.62), laborCost: total - Math.round(total * 0.62), cost: total,
        invoiceNumber, invoiceTotal: done ? total : null, paymentStatus: done ? (recent && chance(0.6) ? "PAY_LATER" : "PAID") : null,
      },
    });
    if (withLines) {
      await db.workOrderLine.createMany({ data: lines.map(([system, work, amount], position) => ({ companyId, workOrderId: wo.id, system, work, amount, position })) });
    }
    const createdAt = (rest.createdAt as Date | undefined) ?? new Date();
    const ev: Ev[] = [{ kind: "STATUS", body: rest.status === "DONE" ? "Logged" : "Opened", at: createdAt, userId: specialist }, ...events];
    if (done && rest.outAt) {
      ev.push({ kind: "STATUS", body: "Completed", at: rest.outAt as Date, userId: specialist });
      ev.push({ kind: "INVOICE", body: `Invoice ${invoiceNumber}`, at: new Date((rest.outAt as Date).getTime() + 2 * HOUR), userId: specialist });
    }
    await db.workOrderEvent.createMany({ data: ev.map((e) => ({ companyId, workOrderId: wo.id, kind: e.kind, stage: e.stage ?? null, body: e.body ?? null, userId: e.userId ?? null, createdAt: e.at })) });
    created.push({ id: wo.id, truckId: wo.truckId, trailerId: wo.trailerId, title: wo.title, status: wo.status, repairType: wo.repairType, outAt: wo.outAt, invoiceNumber });
  }
  const tireRo = created.find((w) => w.truckId === oosTruck.id && w.status === "OPEN" && w.repairType === "TIRES");

  // ---------- Weekly walk-arounds, ratings and defects ----------
  const weekKey = (k: number) => weekStartIn(new Date(now - k * 7 * DAY), spec.locale);
  const thisWeek = weekKey(0);
  type Planned = { truck?: T; trailer?: Trailer; week: number | null; component: string; description: string; severity: string; status: string; owner?: boolean; repair?: string; holds?: boolean; closedWeek?: number };
  const planned: Planned[] = [
    { truck: oosTruck, week: 1, component: "STEER_TIRES", description: "Left steer tire cut in the sidewall, cords showing", severity: "NOW", status: "OPEN", owner: true, repair: tireRo?.id, holds: true },
    { truck: truckAt(1), week: 1, component: "LIGHTS", description: "Right rear marker lamp out", severity: "SOON", status: "OPEN" },
    { truck: truckAt(0), week: 4, component: "BELTS_HOSES", description: "Coolant hose cracked near the radiator", severity: "SOON", status: "OPEN", owner: true },
    { truck: truckAt(5), week: 2, component: "BRAKES", description: "Air leak at a rear brake chamber, audible on the video", severity: "SOON", status: "REPAIRED", owner: true },
    { truck: truckAt(6), week: 3, component: "BODY", description: "Passenger-side mud flap missing", severity: "SOON", status: "CLOSED", closedWeek: 2 },
    { truck: truckAt(9), week: 1, component: "LEAKS", description: "Oil seep at the oil pan gasket", severity: "SOON", status: "OPEN", owner: true },
    { truck: truckAt(8), week: null, component: "GLASS_MIRRORS", description: "Small chip in the windshield, driver side", severity: "WATCH", status: "OPEN" },
    { trailer: trailers[1], week: null, component: "TRAILER_TIRES", description: "Inner dual tire low on tread, axle 2", severity: "SOON", status: "OPEN" },
    { trailer: trailers[trailers.length - 2], week: null, component: "TRAILER", description: "Floor boards broken at the rear door", severity: "NOW", status: "OPEN", holds: true, owner: true },
  ];
  const walk = new Map<string, string>(); // `${truckId}:${week}` → walk-around id
  const drivable = trucks.filter((t) => t.driverId && t.status !== "INACTIVE");
  for (let k = 12; k >= 0; k--) { // a quarter of weeks, for the walk-around compliance report
    const wk = weekKey(k);
    const weekAt = wk.at.getTime();
    for (const [i, t] of drivable.entries()) {
      const mine = planned.filter((p) => p.truck?.id === t.id);
      // This week: some reviewed, some waiting for review, some nothing sent. The truck held by a defect sits parked;
      // a repaired defect waits for this week's video to confirm it. A week where a defect was found was reviewed.
      const pattern = mine.some((p) => p.week === k) ? "clean"
        : k === 0 ? (t.id === oosTruck.id || t.status === "MAINTENANCE" ? "none" : mine.some((p) => p.status === "REPAIRED") ? "review" : ["clean", "review", "none", "clean", "review", "clean"][i % 6])
        : chance(0.9) ? "clean" : "missing";
      if (pattern === "none") continue;
      const span = Math.min(5 * DAY, Math.max(HOUR, (k === 0 ? now : weekAt + 7 * DAY) - weekAt));
      const receivedAt = new Date(weekAt + span * between(0.15, 0.7));
      const reviewedAt = new Date(Math.min(now - 10 * 60_000, receivedAt.getTime() + between(1, 20) * HOUR));
      if (pattern === "missing") {
        const w = await db.walkAround.create({ data: { companyId, truckId: t.id, driverId: t.driverId, weekStart: dateOnly(wk.key), video: "MISSING", reviewedById: reviewer, reviewedAt: new Date(weekAt + 6 * DAY), notes: "No video by Saturday — driver reminded", createdAt: new Date(weekAt + 6 * DAY) } });
        walk.set(`${t.id}:${k}`, w.id);
        continue;
      }
      const reviewed = pattern === "clean";
      const ratings = new Map<string, string>(PTI_COMPONENTS.map((c) => [c, "GOOD"]));
      if (chance(0.25)) ratings.set(pick(["TRAILER_TIRES", "COUPLING", "BATTERY"]), "UNSEEN");
      for (const p of mine) {
        if (p.week == null) continue;
        // Found this week, or still there on a later walk-around until it is closed.
        const stillThere = p.week > k && (p.status === "OPEN" || (p.status === "REPAIRED" && k > 0) || (p.status === "CLOSED" && k > (p.closedWeek ?? 0)));
        if (p.week === k || stillThere) ratings.set(p.component, p.severity === "NOW" ? "NOW" : "SOON");
      }
      const issues = [...ratings.values()].some((r) => r === "SOON" || r === "NOW");
      const w = await db.walkAround.create({
        data: {
          companyId, truckId: t.id, driverId: t.driverId, weekStart: dateOnly(wk.key), video: "RECEIVED", receivedAt,
          result: reviewed ? (issues ? "ISSUES" : "CLEAN") : null, reviewedById: reviewed ? reviewer : null, reviewedAt: reviewed ? reviewedAt : null,
          createdAt: receivedAt,
        },
      });
      walk.set(`${t.id}:${k}`, w.id);
      if (reviewed) {
        await db.walkAroundRating.createMany({ data: [...ratings].map(([component, rating]) => ({ companyId, walkAroundId: w.id, component, rating })) });
      }
    }
  }

  // Defects, numbered in the order they were found.
  const defectRows = planned.filter((p) => p.truck || p.trailer).map((p) => {
    const foundAt = p.week == null ? ago(int(2, 12)) : new Date(weekKey(p.week).at.getTime() + 2.5 * DAY);
    return { p, foundAt: foundAt.getTime() > now ? ago(0.5) : foundAt };
  }).sort((a, b) => a.foundAt.getTime() - b.foundAt.getTime());
  let defectNo = 0;
  for (const { p, foundAt } of defectRows) {
    const closedAt = p.status === "CLOSED" ? new Date(weekKey(p.closedWeek ?? 0).at.getTime() + 3 * DAY) : null;
    const repairedAt = p.status === "REPAIRED" ? ago(3) : closedAt ? new Date(closedAt.getTime() - 2 * DAY) : null;
    let workOrderId = p.repair ?? null;
    if (p.status === "REPAIRED" && p.truck) {
      // The mobile repair that fixed it: waiting for this week's walk-around to confirm.
      workOrderId = created.find((w) => w.truckId === p.truck!.id && w.status === "DONE" && w.title.toLowerCase().includes("brake"))?.id ?? null;
    }
    await db.defect.create({
      data: {
        companyId, number: ++defectNo, truckId: p.truck?.id ?? null, trailerId: p.trailer?.id ?? null,
        walkAroundId: p.truck && p.week != null ? walk.get(`${p.truck.id}:${p.week}`) ?? null : null,
        component: p.component, description: p.description, severity: p.severity, status: p.status,
        holdsUnit: Boolean(p.holds) && p.status !== "CLOSED",
        foundAt, dueAt: new Date(foundAt.getTime() + (DEFECT_DUE_DAYS[p.severity] ?? 14) * DAY),
        ownerId: p.owner ? specialist : null, workOrderId,
        repairedAt, closedAt, closedById: closedAt ? reviewer : null, closeNote: closedAt ? "Fixed — checked on the next walk-around" : null,
        createdAt: foundAt,
      },
    });
  }
  // The repaired brake chamber needs a matching repair for the truck.
  const brakeTruck = truckAt(5);
  if (brakeTruck && !created.some((w) => w.truckId === brakeTruck.id && w.status === "DONE" && w.title.toLowerCase().includes("brake"))) {
    const v = vendorFor(["MOBILE", "SHOP"]);
    const wo = await db.workOrder.create({
      data: {
        companyId, number: ++woNumber, truckId: brakeTruck.id, title: "Air leak — brake chamber", category: "BRAKES", repairType: "REPAIR", status: "DONE", priority: "HIGH",
        scheduledAt: ago(3.4), inAt: ago(3.4), outAt: ago(3), completedAt: ago(3), odometerKm: odoAt(brakeTruck, 3), vendorId: v.id, vendor: v.name,
        cost: 395, partsCost: 145, laborCost: 250, invoiceNumber: `RC-${int(1000, 9999)}`, invoiceTotal: 395, paymentStatus: "PAY_LATER", createdById: specialist, createdAt: ago(3.4),
      },
    });
    await db.workOrderLine.createMany({ data: [{ companyId, workOrderId: wo.id, system: "BRAKES", work: "Brake chamber 30/30", amount: 145, position: 0 }, { companyId, workOrderId: wo.id, system: "FEES", work: "Road call", amount: 250, position: 1 }] });
    await db.defect.updateMany({ where: { companyId, truckId: brakeTruck.id, status: "REPAIRED" }, data: { workOrderId: wo.id } });
  }

  // ---------- Roadside inspections ----------
  let roadside = 0;
  if (spec.roadside) {
    const insp: { d: number; level: number; state: string; location: string; result: string; status: string; due?: number; truck: number; v: [string, string, string, boolean][] }[] = [
      { d: 150, level: 2, state: spec.states[0], location: "Interstate weigh station", result: "CLEAN", status: "CLOSED", truck: 0, v: [] },
      { d: 96, level: 1, state: spec.states[1], location: "Port of entry scale", result: "VIOLATIONS", status: "CLOSED", truck: 1, v: [["393.9(a)", "Inoperable required lamp — right rear clearance", "TRUCK", false], ["393.75(c)", "Tire tread depth less than 2/32 inch", "TRAILER", false]] },
      { d: 70, level: 2, state: spec.states[2], location: "Rest area inspection site", result: "CLEAN", status: "CLOSED", truck: 4, v: [] },
      { d: 41, level: 3, state: spec.states[2], location: "Mobile enforcement, eastbound", result: "VIOLATIONS", status: "CORRECTED", truck: 6, v: [["391.41(a)", "No medical certificate in driver's possession", "DRIVER", false]] },
      { d: 12, level: 1, state: spec.states[3], location: "Weigh station, southbound", result: "OOS", status: "OPEN", due: -2, truck: 5, v: [["396.3(a)(1)", "Brakes out of adjustment — axle 3 right", "TRUCK", true], ["393.9(a)", "Inoperable license plate lamp", "TRUCK", false]] },
      { d: 4, level: 2, state: spec.states[4], location: "Weigh station, westbound", result: "VIOLATIONS", status: "OPEN", due: 11, truck: 2, v: [["393.95(a)", "No properly charged fire extinguisher", "TRUCK", false]] },
    ];
    for (const r of insp) {
      const t = truckAt(r.truck) ?? trucks[0];
      const at = new Date(ago(r.d).getTime() - (ago(r.d).getTime() % DAY) + int(13, 22) * HOUR); // daytime in the US
      const corrected = r.status !== "OPEN";
      const row = await db.roadsideInspection.create({
        data: {
          companyId, inspectedAt: at, reportNumber: `${r.state}${int(10_000, 99_999)}${int(10_000, 99_999)}`, level: r.level, state: r.state, location: r.location,
          driverId: t.driverId, truckId: t.id, trailerId: trailers.find((x) => x.truckId === t.id)?.id ?? null,
          result: r.result, status: r.status, correctionDueAt: r.due != null ? ahead(r.due) : r.v.length ? new Date(at.getTime() + 15 * DAY) : null,
          notes: r.result === "OOS" ? "Truck put out of service at the scale; mobile service adjusted the brakes on site." : null,
          createdById: specialist, createdAt: new Date(at.getTime() + 3 * HOUR),
        },
      });
      roadside++;
      if (r.v.length) {
        await db.roadsideViolation.createMany({
          data: r.v.map(([code, description, unit, oos]) => ({ companyId, inspectionId: row.id, code, description, unit, oos, correctedAt: corrected ? new Date(at.getTime() + int(1, 9) * DAY) : null })),
        });
      }
      if (r.d < 100) {
        await db.document.create({
          data: { companyId, kind: "INSPECTION_REPORT", name: `Inspection_report_${r.state}_${row.reportNumber}.pdf`, storageKey: seedKey(companyId, `roadside/${row.id}`, "report"), contentType: "application/pdf", size: int(80_000, 400_000), roadsideId: row.id, issuedAt: at, uploadedById: specialist, createdAt: new Date(at.getTime() + 4 * HOUR) },
        });
      }
    }
  } else {
    const t = trucks[0];
    await db.roadsideInspection.create({ data: { companyId, inspectedAt: ago(34), level: 2, location: "Ring road checkpoint", driverId: t.driverId, truckId: t.id, result: "CLEAN", status: "CLOSED", createdById: specialist, createdAt: ago(34) } });
    roadside = 1;
  }

  // ---------- Fuel ----------
  const fuel: Prisma.FuelLogCreateManyInput[] = [];
  for (const t of trucks) {
    const lastDay = t.status === "INACTIVE" ? 75 : t.status === "OUT_OF_SERVICE" ? 5 : t.status === "MAINTENANCE" ? 2 : 0;
    let day = lastDay + int(1, 3);
    let prevOdo: number | null = null;
    const fills: { daysAgo: number; odo: number }[] = [];
    while (day < 180) { fills.push({ daysAgo: day, odo: odoAt(t, day) }); day += imperial ? int(1, 3) : int(3, 6); }
    for (const fl of fills.reverse()) {
      const dist = prevOdo == null ? t.daily * 2 : Math.max(0, fl.odo - prevOdo);
      prevOdo = fl.odo;
      const econ = (t.fuelEconomy ?? (spec.economy[0] + spec.economy[1]) / 2) * between(0.93, 1.07);
      const volume = Math.min(t.fuelCapacityL, Math.max(imperial ? 25 : 60, imperial ? dist / econ : (dist * econ) / 100));
      fuel.push({
        companyId, truckId: t.id, driverId: t.driverId, liters: Math.round(volume * 10) / 10,
        cost: round2(volume * between(spec.fuelPrice[0], spec.fuelPrice[1])), station: pick(spec.stations), date: ago(fl.daysAgo + between(0, 0.5)), odometerKm: fl.odo,
      });
    }
  }
  await db.fuelLog.createMany({ data: fuel });

  // ---------- Documents ----------
  const docs: Prisma.DocumentCreateManyInput[] = [];
  const doc = (data: { kind: string; name: string; scope: string; expiresAt?: Date | null; issuedAt?: Date | null; truckId?: string; trailerId?: string; driverId?: string; workOrderId?: string; isCompany?: boolean; at?: Date }) =>
    docs.push({
      companyId, kind: data.kind, name: `${data.name}.pdf`, storageKey: seedKey(companyId, data.scope, data.name), contentType: "application/pdf",
      size: int(90_000, 900_000), expiresAt: data.expiresAt ?? null, issuedAt: data.issuedAt ?? null, truckId: data.truckId, trailerId: data.trailerId, driverId: data.driverId,
      workOrderId: data.workOrderId, isCompany: data.isCompany ?? false, uploadedById: specialist, createdAt: data.at ?? ago(int(10, 300)),
    });
  const year = (d: Date | null) => (d ? new Date(d.getTime() - 365 * DAY) : null);
  for (const [i, t] of trucks.entries()) {
    const scope = `truck/${t.id}`;
    if (i !== 6) doc({ kind: "REGISTRATION", name: `${t.unitNumber}_registration`, scope, issuedAt: year(t.registrationExpiry), expiresAt: t.registrationExpiry, truckId: t.id });
    if (i % 4 !== 3) doc({ kind: "INSPECTION", name: `${t.unitNumber}_annual_inspection`, scope, issuedAt: year(t.inspectionExpiry), expiresAt: t.inspectionExpiry, truckId: t.id });
    doc({ kind: "INSURANCE", name: `${t.unitNumber}_insurance_card`, scope, expiresAt: t.insuranceExpiry, truckId: t.id });
    if (imperial && i % 3 !== 2) doc({ kind: "IFTA", name: `${t.unitNumber}_IFTA_decal`, scope, expiresAt: new Date(new Date(now).getFullYear(), 11, 31), truckId: t.id });
    if (t.ownership === "LEASED") doc({ kind: "LEASE", name: `${t.unitNumber}_lease_agreement`, scope, truckId: t.id });
    if (i % 5 === 0) doc({ kind: "PHOTO", name: `${t.unitNumber}_photo`, scope, truckId: t.id });
  }
  for (const [i, t] of trailers.entries()) {
    const scope = `trailer/${t.id}`;
    if (i % 5 !== 4) doc({ kind: "REGISTRATION", name: `${t.unitNumber}_registration`, scope, expiresAt: ahead(int(60, 700)), trailerId: t.id });
    if (i % 6 !== 5) doc({ kind: "INSPECTION", name: `${t.unitNumber}_annual_inspection`, scope, issuedAt: year(t.inspectionExpiry), expiresAt: t.inspectionExpiry, trailerId: t.id });
    doc({ kind: "INSURANCE", name: `${t.unitNumber}_insurance`, scope, expiresAt: t.insuranceExpiry, trailerId: t.id });
  }
  for (const [i, d] of drivers.entries()) {
    if (i % 5 !== 4) doc({ kind: "LICENSE", name: `${d.name.replace(/\W+/g, "_")}_CDL`, scope: `driver/${d.id}`, expiresAt: d.licenseExpiry, driverId: d.id });
    if (i % 3 !== 2) doc({ kind: "MEDICAL", name: `${d.name.replace(/\W+/g, "_")}_medical_card`, scope: `driver/${d.id}`, expiresAt: d.medicalExpiry, driverId: d.id });
  }
  for (const w of created) {
    if (w.status !== "DONE" || !w.outAt || w.outAt.getTime() < now - 60 * DAY || chance(0.3)) continue;
    doc({ kind: "INVOICE", name: `${w.invoiceNumber ?? "invoice"}`, scope: `wo/${w.id}`, workOrderId: w.id, at: new Date(w.outAt.getTime() + 2 * HOUR) });
  }
  for (const [k, name, exp] of spec.companyDocs) doc({ kind: k, name, scope: "company", expiresAt: exp ? ahead(exp) : null, isCompany: true });
  await db.document.createMany({ data: docs });

  // ---------- Settings & history ----------
  await db.appSetting.create({ data: { companyId, key: "company.profile", value: JSON.stringify(spec.profile) } });
  await db.auditLog.createMany({
    data: [
      { companyId, userId: people.owner, action: "create", entity: "company", entityId: companyId, details: spec.name, createdAt: company.createdAt },
      { companyId, userId: specialist, action: "update", entity: "truck", entityId: trucks[0].id, details: trucks[0].unitNumber, createdAt: ago(1.2) },
      { companyId, userId: specialist, action: "status", entity: "work_order", details: `${shopA.unitNumber} turbo actuator → waiting for parts`, createdAt: ago(2) },
      { companyId, userId: reviewer, action: "review", entity: "walk_around", details: `${oosTruck.unitNumber}: steer tire — out of service`, createdAt: new Date(weekKey(1).at.getTime() + 2.5 * DAY) },
      { companyId, userId: specialist, action: "upload", entity: "document", details: `Insurance card: ${trucks[1].unitNumber}_insurance_card.pdf (truck)`, createdAt: ago(0.4) },
    ],
  });

  return { companyId, trucks: trucks.length, trailers: trailers.length, drivers: drivers.length, workOrders: woNumber, defects: defectNo, roadside, week: thisWeek.key };
}

/* ------------------------------------------------------------------ */
/* Companies and accounts                                              */
/* ------------------------------------------------------------------ */

const usPhone = (areas: string[]) => () => `(${pick(areas)}) 555-01${String(int(0, 99)).padStart(2, "0")}`;
const cdl = (letter: string) => () => `${letter}${int(100, 999)}-${int(1000, 9999)}-${int(1000, 9999)}`;
const US_MODELS: [string, string, string | null, string][] = [
  ["Freightliner", "Cascadia 126", "Freightliner Cascadia", "3AKJHHDR"], ["Volvo", "VNL 860", "Volvo VNL", "4V4NC9EH"], ["Kenworth", "T680", "Kenworth T680", "1XKYD49X"],
  ["Freightliner", "Cascadia 116", "Freightliner Cascadia", "3AKJGLD5"], ["Peterbilt", "579", "Peterbilt 579", "1XPBD49X"], ["International", "LT625", null, "3HSDZAPR"],
];
const US_TYPES: [string, number][] = [["Freightliner Cascadia", 25000], ["Volvo VNL", 20000], ["Kenworth T680", 15000], ["Peterbilt 579", 15000]];
const US_CAPACITY = { DRY_VAN: 45_000, REEFER: 43_500, FLATBED: 48_000, TANKER: 50_000, CONTAINER: 44_000 };

async function main() {
  // The seed WIPES all data. Local dev uses a local Postgres; anything else needs an explicit opt-in.
  const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");
  if (!isLocalDb && process.env.CONFIRM_SEED !== "yes") {
    console.error(`Refusing to seed: this deletes ALL data in ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "the database"}. Re-run with CONFIRM_SEED=yes if you really mean it.`);
    process.exit(1);
  }
  console.log("Resetting database…");
  // Deleting a company cascades to everything it owns.
  await db.auditLog.deleteMany();
  await db.invite.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  // Every demo person has their details on file (made-up ID numbers), as an invited member would.
  const user = (name: string, email: string, lastLoginDays: number) => {
    const [firstName, ...rest] = name.split(" ");
    return db.user.create({
      data: {
        name, firstName, lastName: rest.join(" "), idNumber: `DM${int(1000000, 9999999)}`, birthDate: new Date(Date.UTC(int(1972, 1999), int(0, 11), int(1, 28))),
        email, passwordHash: hash, phone: `+998 90 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`, lastLoginAt: ago(lastLoginDays), createdAt: ago(int(200, 420)),
      },
    });
  };
  reseed(7);
  // Aziza is the fleet specialist. Her own account works for two companies; Nomad Trucking gave her a separate login.
  const aziza = await user("Aziza Karimova", "aziza@demo.local", 0.1);
  const azizaNomad = await user("Aziza Karimova", "aziza@nomadtrucking.demo", 1.5);
  const kamron = await user("Kamron Rakhimov", "owner@demo.local", 0.8);
  const timur = await user("Timur Aliev", "timur@nomadtrucking.demo", 2.2);
  const bekzod = await user("Bekzod Rashidov", "bekzod@demo.local", 0.6);
  const dilnoza = await user("Dilnoza Ergasheva", "viewer@demo.local", 4);

  const silk = await seedCompany({
    name: "Silk Road Freight", color: "#2563EB", seed: 101, locale: { units: "imperial", timezone: "America/Chicago", currency: "USD" },
    truckPrefix: "", firstUnit: 1101, trailerPrefix: "TR", firstTrailer: 5301, trucks: 16, trailers: 14,
    homes: ["Naperville, IL", "Joliet, IL", "Indianapolis, IN"],
    routes: ["Columbus, OH", "Nashville, TN", "St. Louis, MO", "Detroit, MI", "Louisville, KY", "Kansas City, MO", "Memphis, TN", "Minneapolis, MN", "Dallas, TX", "Atlanta, GA"],
    plate: () => `P${int(100000, 999999)}`, trailerPlate: () => `${int(100000, 999999)}ST`, phone: usPhone(["312", "630", "815", "773", "317"]), license: cdl("D"), licenseClass: "A",
    drivers: ["Marcus Hill", "Ruslan Ahmedov", "Dmitri Volkov", "Jamal Carter", "Sardor Yusupov", "Kevin O'Brien", "Luis Ramirez", "Bekhzod Tursunov", "Andre Williams", "Viktor Petrenko", "Shokhrukh Alimov", "Tyler Jensen", "Ibrahim Diallo", "Oleg Marchenko", "Dennis Ward", "Farhod Ismoilov", "Curtis Bell"],
    dispatchers: ["Team Alpha · Sam", "Team Bravo · Nilufar", "Night desk · Eldor"],
    models: US_MODELS, truckTypes: US_TYPES, ownInterval: 15000,
    vendors: [
      { name: "Prairie State Truck Center", type: "DEALER", city: "Joliet, IL", phone: "(815) 555-0141", contactName: "Service desk", address: "2200 Industrial Pkwy" },
      { name: "Lakeside Diesel Repair", type: "SHOP", city: "Naperville, IL", phone: "(630) 555-0187", contactName: "Mike Duran", email: "service@lakesidediesel.example" },
      { name: "Interstate Tire & Wheel", type: "TIRE", city: "Joliet, IL", phone: "(815) 555-0163", contactName: "Rosa" },
      { name: "RoadReady Mobile Service", type: "MOBILE", city: "Chicago, IL", phone: "(312) 555-0129", contactName: "Dispatch line" },
      { name: "Midwest Heavy Towing", type: "TOWING", city: "Chicago, IL", phone: "(773) 555-0110" },
      { name: "Hoosier Truck & Trailer", type: "SHOP", city: "Indianapolis, IN", phone: "(317) 555-0175", contactName: "Greg" },
      { name: "Crossroads Fleet Parts", type: "PARTS", city: "Naperville, IL", phone: "(630) 555-0152" },
    ],
    legacyVendors: ["Lakeside diesel", "Joe's mobile repair"],
    stations: ["Interstate Fuel Plaza #12", "Prairie Fuel Stop", "Crossroads Travel Center", "Mile 88 Diesel", "Heartland Truck Stop"], lessor: "Midland Truck Leasing",
    fuelPrice: [3.55, 4.15], economy: [6.2, 7.6], odo: [120_000, 780_000], daily: [380, 620], tanks: [150, 200, 240],
    trailerTypes: ["DRY_VAN", "DRY_VAN", "REEFER", "DRY_VAN", "FLATBED", "REEFER"], capacity: US_CAPACITY, speed: [55, 68],
    leaseLimit: 120_000, leaseRate: 0.15, states: ["IL", "IN", "OH", "PA", "TN"], roadside: true,
    technicians: ["Mike D.", "Luis", "Dave R.", "Tony", "Sergei"],
    profile: { legalName: "Silk Road Freight Inc.", brand: "", taxId: "36-4820193", licenseNumber: "USDOT 9900412 · MC 9900412", director: "Aziza Karimova", phone: "(630) 555-0100", email: "fleet@silkroadfreight.example", address: "1200 Commerce Dr, Naperville, IL 60563", bank: { name: "Prairie Commerce Bank", account: "000123456789", mfo: "071000000", swift: "PRCBUS44" }, insurance: { carrier: "Great Lakes Mutual", policy: "AL-2026-00419", agent: "Nina Brooks, (630) 555-0177" } },
    companyDocs: [["COMPANY_LICENSE", "USDOT_MC_operating_authority", null], ["COMPANY_INSURANCE", "Auto_liability_and_cargo_COI", int(120, 300)], ["TAX_CERT", "IRS_EIN_letter", null]],
  }, { owner: aziza.id, members: [{ userId: bekzod.id, role: "SPECIALIST" }, { userId: dilnoza.id, role: "VIEWER", lastActiveDays: 4 }] });
  // Silk Road is where Aziza worked last: it is listed first when she picks a company.
  await db.membership.update({ where: { userId_companyId: { userId: aziza.id, companyId: silk.companyId } }, data: { lastActiveAt: ago(0.05) } });

  const caspian = await seedCompany({
    name: "Caspian Carriers", color: "#059669", seed: 7, locale: { units: "imperial", timezone: "America/New_York", currency: "USD" },
    truckPrefix: "", firstUnit: 2201, trailerPrefix: "C", firstTrailer: 801, trucks: 10, trailers: 9,
    homes: ["Allentown, PA", "Harrisburg, PA", "Parsippany, NJ"],
    routes: ["Baltimore, MD", "Richmond, VA", "Albany, NY", "Boston, MA", "Pittsburgh, PA", "Charlotte, NC", "Columbus, OH", "Newark, NJ"],
    plate: () => `AJ${int(10000, 99999)}`, trailerPlate: () => `XJ${int(10000, 99999)}`, phone: usPhone(["610", "717", "973", "484"]), license: cdl("K"), licenseClass: "A",
    drivers: ["Grant Fowler", "Azizbek Nurmatov", "Pavel Sokolov", "Darnell Price", "Jasur Qodirov", "Ray Delgado", "Timur Rashidov", "Brian Kowalski", "Mirjalol Saidov", "Hector Alvarez", "Sean Mitchell"],
    dispatchers: ["Dispatch A · Rita", "Dispatch B · Javlon"],
    models: US_MODELS, truckTypes: US_TYPES, ownInterval: 15000,
    vendors: [
      { name: "Keystone Truck Center", type: "DEALER", city: "Harrisburg, PA", phone: "(717) 555-0144", contactName: "Service advisor" },
      { name: "Lehigh Valley Diesel", type: "SHOP", city: "Allentown, PA", phone: "(610) 555-0168", contactName: "Frank" },
      { name: "Garden State Tire Service", type: "TIRE", city: "Parsippany, NJ", phone: "(973) 555-0133" },
      { name: "Turnpike Road Service", type: "MOBILE", city: "Harrisburg, PA", phone: "(717) 555-0119" },
      { name: "Valley Fleet Parts", type: "PARTS", city: "Allentown, PA", phone: "(610) 555-0190" },
    ],
    legacyVendors: ["Lehigh diesel"],
    stations: ["Keystone Travel Plaza", "Turnpike Fuel #7", "Blue Mountain Diesel", "Valley Truck Stop"], lessor: "Atlantic Fleet Finance",
    fuelPrice: [3.75, 4.35], economy: [6.0, 7.3], odo: [90_000, 650_000], daily: [300, 520], tanks: [150, 200],
    trailerTypes: ["DRY_VAN", "REEFER", "DRY_VAN"], capacity: US_CAPACITY, speed: [55, 65],
    leaseLimit: 110_000, leaseRate: 0.14, states: ["PA", "NJ", "MD", "VA", "NY"], roadside: true,
    technicians: ["Frank", "Jose M.", "Eddie", "Rich"],
    profile: { legalName: "Caspian Carriers LLC", brand: "", taxId: "82-1907735", licenseNumber: "USDOT 9900688 · MC 9900688", director: "Kamron Rakhimov", phone: "(610) 555-0101", email: "ops@caspiancarriers.example", address: "75 Hamilton Blvd, Allentown, PA 18103", bank: { name: "Keystone Savings Bank", account: "000987654321", mfo: "031000000", swift: "KSSBUS33" }, insurance: { carrier: "Atlantic Commercial Insurance", policy: "TRK-88213", agent: "Paul Grant, (610) 555-0155" } },
    companyDocs: [["COMPANY_LICENSE", "USDOT_MC_operating_authority", null], ["COMPANY_INSURANCE", "Auto_liability_and_cargo_COI", 21], ["TAX_CERT", "IRS_EIN_letter", null]],
  }, { owner: kamron.id, members: [{ userId: aziza.id, role: "SPECIALIST", lastActiveDays: 1.1 }] });

  const nomad = await seedCompany({
    name: "Nomad Trucking", color: "#D97706", seed: 33, locale: { units: "metric", timezone: "Asia/Tashkent", currency: "USD" },
    truckPrefix: "N-", firstUnit: 501, trailerPrefix: "NT-", firstTrailer: 601, trucks: 7, trailers: 6,
    homes: ["Fergana", "Andijan", "Namangan"], routes: ["Tashkent", "Samarkand", "Kokand", "Osh", "Bishkek", "Almaty", "Shymkent"],
    plate: () => `40 ${String.fromCharCode(65 + int(0, 25))} ${int(100, 999)} ${pick(["AA", "BA", "KA"])}`, trailerPlate: () => `40 ${int(100, 999)} ${pick(["XA", "XB"])}`,
    phone: () => `+998 9${int(0, 9)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`, license: () => `AF${int(1000000, 9999999)}`, licenseClass: "CE",
    drivers: ["Azamat Osmonov", "Oybek Nurmatov", "Laziz Qodirov", "Sanjar Babaev", "Jamshid Ergashev", "Davron Valiev", "Mirzo Tolibov", "Ilhom Sobirov"],
    dispatchers: ["Kamola (day desk)", "Akbar (night desk)"],
    models: [["Volvo", "FH 500", "Volvo FH", "YV2RT40A"], ["Scania", "R 450", "Scania R", "YS2R4X20"], ["MAN", "TGX 18.510", "MAN TGX", "WMA06XZZ"], ["Mercedes-Benz", "Actros 1845", null, "WDB96340"]],
    truckTypes: [["Volvo FH", 60000], ["Scania R", 45000], ["MAN TGX", 50000]], ownInterval: 30000,
    vendors: [
      { name: "Fergana Truck Service", type: "SHOP", city: "Fergana", phone: "+998 73 244 01 10" },
      { name: "Andijan Auto Repair", type: "SHOP", city: "Andijan", phone: "+998 74 223 45 12" },
      { name: "Vodiy Tire Center", type: "TIRE", city: "Namangan", phone: "+998 69 227 18 30" },
      { name: "Valley Dealer Service", type: "DEALER", city: "Fergana", phone: "+998 73 240 77 00" },
    ],
    legacyVendors: [],
    stations: ["Fuel station #21 Fergana", "Andijan bypass fuel", "Namangan ring road fuel"], lessor: "Asia Leasing",
    fuelPrice: [0.92, 1.04], economy: [29, 36], odo: [60_000, 780_000], daily: [260, 560], tanks: [500, 600, 800],
    trailerTypes: ["DRY_VAN", "DRY_VAN", "REEFER", "FLATBED", "TANKER", "CONTAINER"], capacity: { DRY_VAN: 22_000, REEFER: 21_000, FLATBED: 24_000, TANKER: 30_000, CONTAINER: 22_000 }, speed: [58, 86],
    leaseLimit: 120_000, leaseRate: 0.12, states: [], roadside: false,
    technicians: ["Rustam", "Ulugbek", "Alisher"],
    profile: { legalName: "«Nomad Trucking» LLC", brand: "", taxId: "309 222 777", licenseNumber: "UZ-TR-2022-0871", director: "Timur Aliev", phone: "+998 73 244 00 55", email: "office@nomadtrucking.example", address: "88 Al-Farghani str., Fergana 150100, Uzbekistan", bank: { name: "Valley Commercial Bank", account: "2020 8000 9090 3030 1212", mfo: "00873", swift: "VCBKUZ22" }, insurance: { carrier: "Silk Insurance", policy: "SI-2026-4410", agent: "Rano Saidova, +998 93 410 44 10" } },
    companyDocs: [["COMPANY_LICENSE", "International_haulage_licence", int(200, 500)], ["COMPANY_INSURANCE", "CMR_liability_insurance", int(120, 300)], ["TAX_CERT", "Tax_registration_certificate", null]],
  }, { owner: timur.id, members: [{ userId: azizaNomad.id, role: "SPECIALIST", lastActiveDays: 1.5 }] });

  // A fourth company has invited Aziza: she sees the invitation on the company chooser.
  const turon = await db.company.create({ data: { name: "Turon Logistics", color: "#7C3AED", units: "imperial", timezone: "America/Chicago", currency: "USD", memberships: { create: { userId: kamron.id, role: "OWNER", lastActiveAt: ago(3) } } } });
  await db.invite.create({ data: { companyId: turon.id, email: aziza.email, role: "SPECIALIST", token: "demo-invite-turon-logistics", invitedById: kamron.id, expiresAt: ahead(10) } });
  await db.invite.create({ data: { companyId: silk.companyId, email: "jasur@demo.local", role: "SPECIALIST", token: "demo-invite-silk-road-jasur", invitedById: aziza.id, expiresAt: ahead(6), createdAt: ago(1) } });

  for (const [name, c] of [["Silk Road Freight", silk], ["Caspian Carriers", caspian], ["Nomad Trucking", nomad]] as const) {
    console.log(`  ${name}: ${c.trucks} trucks, ${c.trailers} trailers, ${c.drivers} drivers, ${c.workOrders} repairs, ${c.defects} defects, ${c.roadside} roadside inspections (week of ${c.week})`);
  }
  console.log("Seeded 4 companies and 6 accounts.");
  console.log("  aziza@demo.local          → Silk Road Freight (owner), Caspian Carriers (specialist), invited to Turon Logistics");
  console.log("  aziza@nomadtrucking.demo  → Nomad Trucking (specialist) — a second login for the same person");
  console.log("  owner@demo.local · timur@nomadtrucking.demo · bekzod@demo.local · viewer@demo.local");
  if (!process.env.DEMO_PASSWORD) console.log(`All demo accounts use password: ${DEMO_PASSWORD}`);
  else console.log("All demo accounts use the DEMO_PASSWORD you provided.");
}

main().finally(() => db.$disconnect());
