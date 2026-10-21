import { PrismaClient, type Driver, type Prisma, type Trailer, type Truck } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CITIES, nearestCity } from "../src/lib/constants";

/*
 * Demo data for FleetCore: four companies, one fleet specialist (Aziza) who works for three of them with two
 * different logins, and an open invitation to a fourth. Every row carries its companyId explicitly (this script
 * uses the unscoped client).
 */

const db = new PrismaClient();

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const ahead = (days: number) => new Date(now + days * DAY);
const city = (n: string) => CITIES.find((c) => c.name === n)!;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";

// Deterministic PRNG so the demo looks the same every reseed (re-seeded per company).
let s = 42;
const reseed = (n: number) => { s = n; };
const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;

type CompanySpec = {
  name: string; color: string; seed: number;
  truckPrefix: string; trailerPrefix: string; firstUnit: number;
  trucks: number; trailers: number;
  homes: string[]; groups: string[];
  plateRegion: string;
  drivers: string[];
  vendors: string[];
  stations: string[];
  lessor: string;
  profile: Record<string, unknown>;
};

const MODELS = [
  ["Volvo", "FH 500"], ["Scania", "R 450"], ["MAN", "TGX 18.510"], ["Mercedes-Benz", "Actros 1845"],
  ["DAF", "XF 480"], ["Shacman", "X6000"], ["KAMAZ", "54901"], ["Howo", "TX 440"],
] as const;
const TRAILER_TYPES = ["DRY_VAN", "DRY_VAN", "REEFER", "FLATBED", "TANKER", "CONTAINER"] as const;
const WORK = [
  ["PM", "Engine oil & filters", 420, 180], ["TIRES", "Replace steer tires", 980, 120], ["INSPECTION", "Annual technical inspection", 60, 90],
  ["BRAKES", "Brake pads & discs", 640, 260], ["PM", "Full PM service", 700, 300], ["ENGINE", "Air compressor replacement", 1200, 380],
  ["COOLING", "Radiator hose & coolant", 210, 140], ["ELECTRICAL", "Alternator replacement", 540, 220], ["BODY", "Mirror & step repair", 160, 90],
] as const;
const seedKey = (companyId: string, scope: string, name: string) => `seed/${companyId}/${scope}/${name.replace(/[^\w.-]+/g, "_")}.pdf`;

async function seedCompany(spec: CompanySpec, people: { owner: string; members: { userId: string; role: string; lastActiveDays?: number }[] }) {
  reseed(spec.seed);
  const company = await db.company.create({ data: { name: spec.name, color: spec.color, createdAt: ago(int(200, 400)) } });
  const companyId = company.id;
  const all = [{ userId: people.owner, role: "OWNER" }, ...people.members];
  for (const m of all) {
    await db.membership.create({
      data: { companyId, userId: m.userId, role: m.role, createdAt: ago(int(30, 190)), lastActiveAt: "lastActiveDays" in m && m.lastActiveDays != null ? ago(m.lastActiveDays) : ago(between(0.2, 9)) },
    });
  }
  const specialist = people.members.find((m) => m.role === "SPECIALIST")?.userId ?? people.owner;

  // ---------- Drivers ----------
  const drivers: Driver[] = [];
  for (const [i, name] of spec.drivers.entries()) {
    const type = i === spec.drivers.length - 1 ? "LEASE" : i % 5 === 0 ? "OWNER_OPERATOR" : "COMPANY";
    drivers.push(await db.driver.create({
      data: {
        companyId, name, type,
        email: chance(0.6) ? `${name.split(" ")[0].toLowerCase()}@${spec.name.toLowerCase().replace(/[^a-z]+/g, "")}.example` : null,
        phone: `+998 9${int(0, 9)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`,
        phone2: chance(0.35) ? `+998 9${int(0, 9)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}` : null,
        licenseNumber: `AF${int(1000000, 9999999)}`,
        licenseClass: "CE",
        // A couple expiring or expired so alerts show up.
        licenseExpiry: ahead(i === 3 ? 12 : i === 6 ? -5 : int(120, 1400)),
        medicalExpiry: ahead(i === 4 ? 20 : int(60, 700)),
        hireDate: ago(int(90, 2400)),
        score: i === 6 ? 62 : i === 2 ? 78 : int(84, 100),
        status: i === spec.drivers.length - 2 ? "ON_LEAVE" : "ACTIVE",
        hold: i === 6, holdReason: i === 6 ? "Licence expired — renewal pending" : null,
        createdAt: ago(int(60, 300)),
      },
    }));
  }
  const assignable = drivers.filter((d) => d.status === "ACTIVE" && !d.hold);

  // ---------- Trucks ----------
  const trucks: (Truck & { dailyKm: number })[] = [];
  for (let i = 0; i < spec.trucks; i++) {
    const [make, model] = MODELS[(i + spec.seed) % MODELS.length];
    const home = city(spec.homes[i % spec.homes.length]);
    const odo = int(60_000, 780_000);
    const pmIntervalKm = pick([30000, 35000]);
    const status = i === spec.trucks - 2 ? "MAINTENANCE" : i === spec.trucks - 1 ? "OUT_OF_SERVICE" : "ACTIVE";
    const dailyKm = status === "ACTIVE" ? int(260, 560) : int(80, 200);
    const lastPmKm = odo - int(3000, 42000); // some overdue
    const leased = i === 2 || i === 5;
    // Some trucks are rolling between cities, the rest parked near a depot.
    const rolling = status === "ACTIVE" && chance(0.45);
    const dest = city(pick(spec.homes.concat(["Tashkent", "Samarkand", "Jizzakh"])));
    const t = rolling ? between(0.2, 0.8) : 0;
    const lat = rolling ? home.lat + (dest.lat - home.lat) * t : home.lat + between(-0.03, 0.03);
    const lng = rolling ? home.lng + (dest.lng - home.lng) * t : home.lng + between(-0.03, 0.03);
    const stale = status === "ACTIVE" && !rolling && i % 6 === 4; // a tracker that went quiet
    const driver = status === "ACTIVE" && i < assignable.length ? assignable[i] : null;
    const truck = await db.truck.create({
      data: {
        companyId,
        unitNumber: `${spec.truckPrefix}${String(spec.firstUnit + i).padStart(spec.truckPrefix.length > 2 ? 3 : 2, "0")}`,
        make, model, year: int(2015, 2025),
        vin: `YV2${int(10000000, 99999999)}${int(100000, 999999)}`,
        plate: `${spec.plateRegion} ${String.fromCharCode(65 + (i % 26))} ${int(100, 999)} ${pick(["AA", "BA", "KA", "MA"])}`,
        status,
        ownership: leased ? "LEASED" : i % 5 === 4 ? "OWNER_OPERATOR" : "COMPANY",
        group: spec.groups[i % spec.groups.length],
        lessor: leased ? spec.lessor : null,
        leaseStartKm: leased ? odo - (i === 5 ? 128_000 : 70_000) : null,
        leaseAnnualLimitKm: leased ? 120_000 : null,
        leaseBufferPct: leased ? 5 : null,
        leaseOverageRate: leased ? 0.12 : null,
        odometerKm: odo,
        pmIntervalKm, lastPmKm, lastPmAt: ago(Math.max(3, Math.round((odo - lastPmKm) / dailyKm))),
        nextServiceKm: lastPmKm + pmIntervalKm,
        fuelCapacityL: pick([500, 600, 800]),
        insuranceExpiry: ahead(i === 1 ? 9 : i === 7 ? -3 : int(40, 360)),
        inspectionExpiry: ahead(i === 4 ? 18 : int(40, 360)),
        registrationExpiry: ahead(int(60, 700)),
        lat, lng, locationName: nearestCity(lat, lng).label,
        speedKmh: rolling ? int(58, 86) : 0,
        heading: rolling ? int(0, 359) : 0,
        engineOn: rolling || chance(0.15),
        fuelPct: int(rolling ? 18 : 30, 95),
        fuelEconomy: Math.round(between(29, 36) * 10) / 10,
        lastPingAt: stale ? ago(int(3, 6)) : new Date(now - int(1, rolling ? 4 : 50) * 60_000),
        pingSource: i % 3 === 0 ? "SAMSARA" : "DEVICE",
        driverId: driver?.id ?? null,
        createdAt: ago(int(120, 400)),
      },
    });
    trucks.push({ ...truck, dailyKm });
  }

  // ---------- Trailers ----------
  const trailers: Trailer[] = [];
  for (let i = 0; i < spec.trailers; i++) {
    const type = TRAILER_TYPES[i % TRAILER_TYPES.length];
    const yard = city(spec.homes[0]);
    const status = i === spec.trailers - 1 ? "SHOP" : i === spec.trailers - 2 ? "OUT_OF_SERVICE" : i < Math.min(trucks.length - 3, Math.ceil(spec.trailers / 2)) ? "IN_USE" : i % 3 === 0 ? "DROPPED" : "YARD";
    const pairedTruck = status === "IN_USE" ? trucks[i] : null;
    const dropCity = city(pick(spec.homes.concat(["Jizzakh", "Navoi"])));
    const at = pairedTruck ? { lat: pairedTruck.lat!, lng: pairedTruck.lng! } : status === "DROPPED" ? dropCity : yard;
    trailers.push(await db.trailer.create({
      data: {
        companyId,
        unitNumber: `${spec.trailerPrefix}${String(spec.firstUnit + 100 + i)}`, type, year: int(2014, 2024),
        capacityKg: type === "TANKER" ? 30_000 : type === "FLATBED" ? 24_000 : 22_000,
        plate: `${spec.plateRegion} ${int(100, 999)} ${pick(["XA", "XB"])}`,
        status, statusSince: ago(status === "SHOP" ? 10 : status === "DROPPED" ? int(2, 6) : int(0, 20)),
        truckId: pairedTruck?.id ?? null,
        lat: at.lat + between(-0.02, 0.02), lng: at.lng + between(-0.02, 0.02),
        locationName: pairedTruck ? pairedTruck.locationName : status === "DROPPED" ? `${dropCity.name} customer yard` : status === "SHOP" ? spec.vendors[0] : `${yard.name} yard`,
        gpsProvider: i < spec.trailers - 3 ? pick(["Teltonika", "Wialon"]) : null,
        lastPingAt: i < spec.trailers - 3 ? new Date(now - int(5, 600) * 60_000) : null,
        insuranceExpiry: ahead(int(30, 500)),
        inspectionExpiry: ahead(i === 2 ? 14 : int(30, 500)),
        createdAt: ago(int(120, 400)),
      },
    }));
  }

  // ---------- Fuel (odometer readings that rise with time) and work orders ----------
  let woNumber = 0;
  const wo = (data: Omit<Prisma.WorkOrderUncheckedCreateInput, "number" | "companyId">) =>
    db.workOrder.create({ data: { ...data, companyId, number: ++woNumber } });
  const odoAt = (t: (typeof trucks)[number], daysAgo: number) => Math.max(0, Math.round(t.odometerKm - t.dailyKm * daysAgo - between(0, 40)));

  // Completed work, oldest first so numbers grow with time.
  const jobs: { truck: (typeof trucks)[number]; daysAgo: number; w: (typeof WORK)[number] }[] = [];
  for (const t of trucks) {
    for (let k = 0; k < int(2, 5); k++) jobs.push({ truck: t, daysAgo: int(8, 175), w: pick(WORK) });
    // The PM that set the truck's last PM reading.
    const pmDays = Math.max(3, Math.round((t.odometerKm - (t.lastPmKm ?? t.odometerKm)) / t.dailyKm));
    jobs.push({ truck: t, daysAgo: Math.min(175, pmDays), w: WORK[4] });
  }
  jobs.sort((a, b) => b.daysAgo - a.daysAgo);
  for (const j of jobs) {
    const [category, title, parts, labor] = j.w;
    const inAt = ago(j.daysAgo);
    const outAt = new Date(inAt.getTime() + int(4, 72) * HOUR);
    const p = Math.round(parts * between(0.85, 1.25));
    const l = Math.round(labor * between(0.85, 1.25));
    await wo({
      truckId: j.truck.id, title, category, status: "DONE", priority: pick(["LOW", "MEDIUM", "MEDIUM", "HIGH"]),
      scheduledAt: inAt, inAt, outAt, completedAt: outAt, partsCost: p, laborCost: l, cost: p + l,
      vendor: pick(spec.vendors), odometerKm: category === "PM" && j.w === WORK[4] && j.truck.lastPmKm ? j.truck.lastPmKm : odoAt(j.truck, j.daysAgo),
      createdById: specialist, createdAt: inAt,
    });
  }
  for (const t of trucks) {
    // Open and upcoming work.
    if (chance(0.45)) {
      const [category, title, parts, labor] = pick(WORK);
      const late = chance(0.3);
      await wo({
        truckId: t.id, title, category, status: chance(0.2) ? "DRAFT" : "OPEN", priority: pick(["LOW", "MEDIUM", "HIGH"]),
        scheduledAt: late ? ago(int(1, 6)) : ahead(int(1, 25)), partsCost: parts, laborCost: labor, cost: parts + labor,
        vendor: pick(spec.vendors), createdById: specialist,
      });
    }
    // Fuel fills every few days for six months.
    let day = int(1, 4);
    let prevOdo: number | null = null;
    const fills: { daysAgo: number; odo: number }[] = [];
    while (day < 180) { fills.push({ daysAgo: day, odo: odoAt(t, day) }); day += int(3, 7); }
    for (const f of fills.reverse()) {
      const km = prevOdo == null ? t.dailyKm * 4 : Math.max(0, f.odo - prevOdo);
      prevOdo = f.odo;
      const liters = Math.max(60, Math.round((km * (t.fuelEconomy ?? 32)) / 100));
      await db.fuelLog.create({
        data: { companyId, truckId: t.id, driverId: t.driverId, liters, cost: Math.round(liters * between(0.92, 1.04) * 100) / 100, station: pick(spec.stations), date: ago(f.daysAgo + between(0, 0.5)), odometerKm: f.odo },
      });
    }
  }
  // In the shop right now.
  const inShop = trucks.find((t) => t.status === "MAINTENANCE")!;
  await wo({ truckId: inShop.id, title: "Gearbox overhaul", description: "Hard shifting 3→4, metal in the oil. Full overhaul with new synchros.", category: "ENGINE", status: "IN_PROGRESS", priority: "HIGH", scheduledAt: ago(2), inAt: ago(2), partsCost: 2600, laborCost: 1200, cost: 3800, vendor: spec.vendors[0], odometerKm: inShop.odometerKm, createdById: specialist });
  const shopTrailer = trailers.find((t) => t.status === "SHOP")!;
  await wo({ trailerId: shopTrailer.id, title: "Rear door hinge & seal", category: "BODY", status: "IN_PROGRESS", priority: "MEDIUM", scheduledAt: ago(10), inAt: ago(10), partsCost: 260, laborCost: 180, cost: 440, vendor: spec.vendors[1] ?? spec.vendors[0], createdById: specialist });
  await wo({ truckId: trucks[3].id, title: "Check DPF warning light", category: "ENGINE", status: "DRAFT", priority: "MEDIUM", scheduledAt: ahead(3), createdById: specialist });

  // ---------- Documents ----------
  const doc = (data: { kind: string; name: string; scope: string; expiresAt?: Date | null; truckId?: string; trailerId?: string; driverId?: string; isCompany?: boolean }) =>
    db.document.create({
      data: {
        companyId, kind: data.kind, name: `${data.name}.pdf`, storageKey: seedKey(companyId, data.scope, data.name), contentType: "application/pdf",
        size: int(90_000, 900_000), expiresAt: data.expiresAt ?? null, truckId: data.truckId, trailerId: data.trailerId, driverId: data.driverId,
        isCompany: data.isCompany ?? false, uploadedById: specialist, createdAt: ago(int(10, 300)),
      },
    });
  for (const [i, t] of trucks.entries()) {
    const have = i % 4 === 3 ? ["REGISTRATION", "INSURANCE"] : i % 7 === 6 ? [] : ["REGISTRATION", "INSURANCE", "INSPECTION"];
    for (const k of have) {
      const exp = k === "INSURANCE" ? t.insuranceExpiry : k === "INSPECTION" ? t.inspectionExpiry : t.registrationExpiry;
      await doc({ kind: k, name: `${t.unitNumber}_${k.toLowerCase()}`, scope: `truck/${t.id}`, expiresAt: exp, truckId: t.id });
    }
  }
  for (const [i, t] of trailers.entries()) {
    const have = i % 5 === 4 ? ["REGISTRATION"] : i % 7 === 6 ? [] : ["REGISTRATION", "INSURANCE", "INSPECTION"];
    for (const k of have) {
      const exp = k === "INSURANCE" ? t.insuranceExpiry : k === "INSPECTION" ? t.inspectionExpiry : ahead(int(60, 700));
      await doc({ kind: k, name: `${t.unitNumber}_${k.toLowerCase()}`, scope: `trailer/${t.id}`, expiresAt: exp, trailerId: t.id });
    }
  }
  for (const [i, d] of drivers.entries()) {
    if (i % 5 !== 4) await doc({ kind: "LICENSE", name: `${d.name.replace(" ", "_")}_licence`, scope: `driver/${d.id}`, expiresAt: d.licenseExpiry, driverId: d.id });
    if (i % 3 !== 2) await doc({ kind: "MEDICAL", name: `${d.name.replace(" ", "_")}_medical`, scope: `driver/${d.id}`, expiresAt: d.medicalExpiry, driverId: d.id });
  }
  const companyDocs = [["COMPANY_LICENSE", "International_haulage_licence", int(200, 500)], ["COMPANY_INSURANCE", "CMR_liability_insurance", spec.seed === 7 ? 21 : int(120, 300)], ["TAX_CERT", "Tax_registration_certificate", null]] as const;
  for (const [k, name, exp] of companyDocs) await doc({ kind: k, name, scope: "company", expiresAt: exp ? ahead(exp) : null, isCompany: true });

  // ---------- Settings & history ----------
  await db.appSetting.create({ data: { companyId, key: "company.profile", value: JSON.stringify(spec.profile) } });
  await db.auditLog.createMany({
    data: [
      { companyId, userId: people.owner, action: "create", entity: "company", entityId: companyId, details: spec.name, createdAt: company.createdAt },
      { companyId, userId: specialist, action: "update", entity: "truck", entityId: trucks[0].id, details: trucks[0].unitNumber, createdAt: ago(1.2) },
      { companyId, userId: specialist, action: "status", entity: "work_order", details: `${inShop.unitNumber} gearbox overhaul → IN_PROGRESS`, createdAt: ago(2) },
      { companyId, userId: specialist, action: "upload", entity: "document", details: `Insurance: ${trucks[1].unitNumber}_insurance.pdf (truck)`, createdAt: ago(0.4) },
    ],
  });

  return { companyId, trucks: trucks.length, trailers: trailers.length, drivers: drivers.length, workOrders: woNumber };
}

async function main() {
  // The seed WIPES all data. Local dev uses a local Postgres; anything else needs an explicit opt-in.
  const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");
  if (!isLocalDb && process.env.CONFIRM_SEED !== "yes") {
    console.error(`Refusing to seed: this deletes ALL data in ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "the database"}. Re-run with CONFIRM_SEED=yes if you really mean it.`);
    process.exit(1);
  }
  console.log("Resetting database…");
  for (const m of [db.document, db.fuelLog, db.workOrder, db.trailer, db.truck, db.driver, db.appSetting, db.auditLog, db.invite, db.membership, db.company, db.user] as unknown as { deleteMany: () => Promise<unknown> }[]) {
    await m.deleteMany();
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = (name: string, email: string, lastLoginDays: number) =>
    db.user.create({ data: { name, email, passwordHash: hash, phone: `+998 90 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`, lastLoginAt: ago(lastLoginDays), createdAt: ago(int(200, 420)) } });
  reseed(7);
  // Aziza is the fleet specialist. Her own account works for two companies; Nomad Trucking gave her a separate login.
  const aziza = await user("Aziza Karimova", "aziza@demo.local", 0.1);
  const azizaNomad = await user("Aziza Karimova", "aziza@nomadtrucking.demo", 1.5);
  const kamron = await user("Kamron Rakhimov", "owner@demo.local", 0.8);
  const timur = await user("Timur Aliev", "timur@nomadtrucking.demo", 2.2);
  const bekzod = await user("Bekzod Rashidov", "bekzod@demo.local", 0.6);
  const dilnoza = await user("Dilnoza Ergasheva", "viewer@demo.local", 4);

  const silk = await seedCompany({
    name: "Silk Road Freight", color: "#2563EB", seed: 101, truckPrefix: "T-", trailerPrefix: "TR-", firstUnit: 101, trucks: 14, trailers: 14,
    homes: ["Tashkent", "Tashkent", "Samarkand"], groups: ["Tashkent", "Samarkand"], plateRegion: "01",
    drivers: ["Rustam Nazarov", "Sherzod Tursunov", "Jasur Abdullaev", "Otabek Mirzaev", "Farrukh Kholmatov", "Ulugbek Saidov", "Akmal Rakhimov", "Sardor Umarov", "Nodir Ismoilov", "Bobur Kadyrov", "Anvar Sultanov", "Dilshod Hamidov", "Eldor Qosimov", "Javlon Normatov"],
    vendors: ["UzTruck Service", "Volvo Center Tashkent", "MAN Service Chirchiq", "In-house workshop"],
    stations: ["UzGasOil #14", "Lukoil M39", "Saneg A-380", "Mustang Fuel"], lessor: "UzAuto Leasing",
    profile: { legalName: "«Silk Road Freight» LLC", brand: "", taxId: "305 123 456", licenseNumber: "UZ-TR-2021-0456", director: "Aziza Karimova", phone: "+998 71 200 10 10", email: "fleet@silkroadfreight.example", address: "12 Amir Temur str., Tashkent 100000, Uzbekistan", bank: { name: "Kapitalbank", account: "2020 8000 1234 5678 9012", mfo: "01088", swift: "KACHUZ22" }, insurance: { carrier: "Uzbekinvest", policy: "CMR-2026-00419", agent: "Nilufar Yuldasheva, +998 90 123 45 67" } },
  }, { owner: aziza.id, members: [{ userId: bekzod.id, role: "SPECIALIST" }, { userId: dilnoza.id, role: "VIEWER", lastActiveDays: 4 }] });
  // Silk Road is where Aziza worked last: it is listed first when she picks a company.
  await db.membership.update({ where: { userId_companyId: { userId: aziza.id, companyId: silk.companyId } }, data: { lastActiveAt: ago(0.05) } });

  const caspian = await seedCompany({
    name: "Caspian Carriers", color: "#059669", seed: 7, truckPrefix: "C-", trailerPrefix: "CT-", firstUnit: 1, trucks: 9, trailers: 8,
    homes: ["Bukhara", "Samarkand", "Navoi"], groups: ["Bukhara", "Navoi"], plateRegion: "80",
    drivers: ["Shukhrat Olimov", "Bakhrom Tojiev", "Ravshan Usmonov", "Islom Yusupov", "Murod Kholikov", "Zafar Nematov", "Komil Rasulov", "Asror Safarov", "Behruz Aminov"],
    vendors: ["Bukhara Truck Center", "Scania Service Samarkand", "Navoi Diesel"],
    stations: ["UzGasOil #3", "Lukoil Bukhara", "Saneg Navoi"], lessor: "Orient Finans Leasing",
    profile: { legalName: "«Caspian Carriers» JSC", brand: "", taxId: "307 654 321", licenseNumber: "UZ-TR-2019-0112", director: "Kamron Rakhimov", phone: "+998 65 221 33 44", email: "ops@caspiancarriers.example", address: "5 Bahouddin Naqshband str., Bukhara 200100, Uzbekistan", bank: { name: "Hamkorbank", account: "2020 8000 5555 1111 2222", mfo: "00083", swift: "KHKKUZ22" }, insurance: { carrier: "Gross Insurance", policy: "GR-CMR-88213", agent: "Sevara Ahmedova, +998 91 555 22 11" } },
  }, { owner: kamron.id, members: [{ userId: aziza.id, role: "SPECIALIST", lastActiveDays: 1.1 }] });

  const nomad = await seedCompany({
    name: "Nomad Trucking", color: "#D97706", seed: 33, truckPrefix: "N-", trailerPrefix: "NT-", firstUnit: 501, trucks: 7, trailers: 6,
    homes: ["Fergana", "Andijan", "Namangan"], groups: ["Fergana valley"], plateRegion: "40",
    drivers: ["Azamat Osmonov", "Oybek Nurmatov", "Laziz Qodirov", "Sanjar Babaev", "Jamshid Ergashev", "Doniyor Valiev", "Mirzo Tolibov"],
    vendors: ["Fergana Truck Service", "Andijan Auto Repair"],
    stations: ["UzGasOil #21", "Lukoil Fergana", "Mustang Andijan"], lessor: "Asia Leasing",
    profile: { legalName: "«Nomad Trucking» LLC", brand: "", taxId: "309 222 777", licenseNumber: "UZ-TR-2022-0871", director: "Timur Aliev", phone: "+998 73 244 00 55", email: "office@nomadtrucking.example", address: "88 Al-Farghani str., Fergana 150100, Uzbekistan", bank: { name: "Ipoteka Bank", account: "2020 8000 9090 3030 1212", mfo: "00873", swift: "UJSIUZ22" }, insurance: { carrier: "Kafolat", policy: "KF-2026-4410", agent: "Rano Saidova, +998 93 410 44 10" } },
  }, { owner: timur.id, members: [{ userId: azizaNomad.id, role: "SPECIALIST", lastActiveDays: 1.5 }] });

  // A fourth company has invited Aziza: she sees the invitation on the company chooser.
  const turon = await db.company.create({ data: { name: "Turon Logistics", color: "#7C3AED", memberships: { create: { userId: kamron.id, role: "OWNER", lastActiveAt: ago(3) } } } });
  await db.invite.create({ data: { companyId: turon.id, email: aziza.email, role: "SPECIALIST", token: "demo-invite-turon-logistics", invitedById: kamron.id, expiresAt: ahead(10) } });
  await db.invite.create({ data: { companyId: silk.companyId, email: "jasur@demo.local", role: "SPECIALIST", token: "demo-invite-silk-road-jasur", invitedById: aziza.id, expiresAt: ahead(6), createdAt: ago(1) } });

  for (const [name, c] of [["Silk Road Freight", silk], ["Caspian Carriers", caspian], ["Nomad Trucking", nomad]] as const) {
    console.log(`  ${name}: ${c.trucks} trucks, ${c.trailers} trailers, ${c.drivers} drivers, ${c.workOrders} work orders`);
  }
  console.log("Seeded 4 companies and 6 accounts.");
  console.log("  aziza@demo.local          → Silk Road Freight (owner), Caspian Carriers (specialist), invited to Turon Logistics");
  console.log("  aziza@nomadtrucking.demo  → Nomad Trucking (specialist) — a second login for the same person");
  console.log("  owner@demo.local · timur@nomadtrucking.demo · bekzod@demo.local · viewer@demo.local");
  if (!process.env.DEMO_PASSWORD) console.log(`All demo accounts use password: ${DEMO_PASSWORD}`);
  else console.log("All demo accounts use the DEMO_PASSWORD you provided.");
}

main().finally(() => db.$disconnect());
