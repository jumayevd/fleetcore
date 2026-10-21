import { PrismaClient, type Customer, type Driver, type Team, type Trailer, type Truck, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CITIES, nearestCity } from "../src/lib/constants";
import { routeKm, pathPolyline, pointAlongPolyline } from "../src/lib/geo";

const db = new PrismaClient();

// Deterministic PRNG so the demo looks the same every reseed.
let s = 42;
const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const city = (n: string) => CITIES.find((c) => c.name === n)!;
const seedKey = (scope: string, name: string) => `seed/${scope}/${name.replace(/[^\w.-]+/g, "_")}.pdf`;

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";
const AVG_SPEED = 58;

async function main() {
  // The seed WIPES all data. Local dev uses a local Postgres; anything else needs an explicit opt-in.
  const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");
  if (!isLocalDb && process.env.CONFIRM_SEED !== "yes") {
    console.error(`Refusing to seed: this deletes ALL data in ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "the database"}. Re-run with CONFIRM_SEED=yes if you really mean it.`);
    process.exit(1);
  }
  console.log("Resetting database…");
  const tables = [db.chatMessage, db.announcement, db.claimNote, db.claim, db.document, db.boardCell, db.driverStatusEvent, db.appSetting, db.auditLog, db.invoice, db.loadEvent, db.stop, db.load, db.fuelLog, db.workOrder, db.trailer, db.truck, db.driver, db.team, db.customer, db.user] as unknown as { deleteMany: () => Promise<unknown> }[];
  for (const m of tables) await m.deleteMany();

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ---------- Teams & staff ----------
  const teams: Team[] = [];
  for (const [i, t] of [{ name: "Team Alpha", color: "#3B82F6" }, { name: "Team Bravo", color: "#10B981" }].entries()) {
    teams.push(await db.team.create({ data: { ...t, sortOrder: i } }));
  }
  const staff = [
    { name: "Kamron Rakhimov", email: "owner@demo.local", role: "OWNER" },
    { name: "Aziza Karimova", email: "admin@demo.local", role: "ADMIN" },
    { name: "Bekzod Rashidov", email: "dispatch@demo.local", role: "DISPATCHER", teamId: teams[0].id },
    { name: "Malika Yusupova", email: "dispatch2@demo.local", role: "DISPATCHER", teamId: teams[1].id },
    { name: "Timur Aliev", email: "fleet@demo.local", role: "FLEET_MANAGER" },
    { name: "Dilnoza Ergasheva", email: "accounting@demo.local", role: "ACCOUNTANT" },
  ];
  const users: User[] = [];
  for (const u of staff) users.push(await db.user.create({ data: { ...u, passwordHash: hash, phone: `+998 90 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`, lastLoginAt: ago(between(0, 3)) } }));
  const dispatchers = users.filter((u) => u.role === "DISPATCHER");
  const byRole = (r: string) => users.find((u) => u.role === r)!;

  // ---------- Drivers (each with a login) ----------
  const driverNames = [
    "Rustam Nazarov", "Sherzod Tursunov", "Jasur Abdullaev", "Otabek Mirzaev", "Farrukh Kholmatov",
    "Ulugbek Saidov", "Akmal Rakhimov", "Sardor Umarov", "Nodir Ismoilov", "Bobur Kadyrov",
    "Anvar Sultanov", "Dilshod Hamidov", "Eldor Qosimov", "Javlon Normatov",
  ];
  const drivers: Driver[] = [];
  for (const [i, name] of driverNames.entries()) {
    const email = i === 0 ? "driver@demo.local" : `${name.split(" ")[0].toLowerCase()}@demo.local`;
    const user = await db.user.create({ data: { name, email, passwordHash: hash, role: "DRIVER" } });
    const type = i === 13 ? "LEASE" : i % 5 === 0 ? "OWNER_OPERATOR" : "COMPANY";
    drivers.push(
      await db.driver.create({
        data: {
          name, email, userId: user.id, type,
          teamId: teams[i % 2].id,
          phone: `+998 9${int(0, 9)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`,
          phone2: chance(0.4) ? `+998 9${int(0, 9)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}` : null,
          licenseNumber: `AF${int(1000000, 9999999)}`,
          licenseClass: "CE",
          // a couple expiring soon so alerts show up
          licenseExpiry: new Date(now + (i === 3 ? 12 : i === 7 ? -5 : int(120, 1400)) * DAY),
          medicalExpiry: new Date(now + (i === 5 ? 20 : int(60, 700)) * DAY),
          hireDate: ago(int(90, 2400)),
          payPerKm: Math.round(between(0.3, 0.45) * 100) / 100,
          rating: Math.round(between(4.1, 5) * 10) / 10,
          score: i === 7 ? 62 : i === 9 ? 78 : int(86, 100),
          status: i === 12 ? "ON_LEAVE" : "ACTIVE",
          hold: i === 7, holdReason: i === 7 ? "Licence expired — renewal pending" : null,
        },
      }),
    );
  }

  // ---------- Fleet ----------
  const models = [
    ["Volvo", "FH 500"], ["Scania", "R 450"], ["MAN", "TGX 18.510"], ["Mercedes-Benz", "Actros 1845"],
    ["DAF", "XF 480"], ["Shacman", "X6000"], ["KAMAZ", "54901"], ["Howo", "TX 440"],
  ] as const;
  const trucks: Truck[] = [];
  for (let i = 0; i < 14; i++) {
    const [make, model] = models[i % models.length];
    const home = city(pick(["Tashkent", "Tashkent", "Tashkent", "Samarkand", "Fergana"]));
    const odo = int(40_000, 780_000);
    const pmIntervalKm = pick([30000, 35000]);
    const lastPmKm = odo - int(3000, 42000); // some overdue
    const leased = i === 10 || i === 11;
    const lat = home.lat + between(-0.03, 0.03), lng = home.lng + between(-0.03, 0.03);
    trucks.push(
      await db.truck.create({
        data: {
          unitNumber: `T-${String(101 + i)}`,
          make, model, year: int(2015, 2025),
          vin: `YV2${int(10000000, 99999999)}${int(100000, 999999)}`,
          plate: `01 ${String.fromCharCode(65 + (i % 26))} ${int(100, 999)} ${pick(["AA", "BA", "KA", "MA"])}`,
          status: i === 12 ? "MAINTENANCE" : i === 13 ? "OUT_OF_SERVICE" : "ACTIVE",
          ownership: i % 5 === 0 && i < 10 ? "OWNER_OPERATOR" : leased ? "LEASED" : "COMPANY",
          group: i < 9 ? "Tashkent" : "Fergana",
          lessor: leased ? "UzAuto Leasing" : null,
          leaseStartKm: leased ? odo - (i === 11 ? 128_000 : 70_000) : null,
          leaseAnnualLimitKm: leased ? 120_000 : null,
          leaseBufferPct: leased ? 5 : null,
          leaseOverageRate: leased ? 0.12 : null,
          odometerKm: odo,
          pmIntervalKm, lastPmKm, lastPmAt: ago(int(20, 200)),
          nextServiceKm: lastPmKm + pmIntervalKm,
          fuelCapacityL: pick([500, 600, 800]),
          insuranceExpiry: new Date(now + (i === 2 ? 9 : int(40, 360)) * DAY),
          inspectionExpiry: new Date(now + (i === 6 ? 18 : int(40, 360)) * DAY),
          registrationExpiry: new Date(now + int(60, 700) * DAY),
          lat, lng, locationName: nearestCity(lat, lng).label,
          speedKmh: 0, heading: 0, fuelPct: int(20, 95), engineOn: false,
          lastPingAt: new Date(now - int(1, 90) * 60_000), pingSource: "SIMULATED",
          driverId: i < drivers.length - 2 ? drivers[i].id : null,
        },
      }),
    );
  }

  const trailerTypes = ["DRY_VAN", "DRY_VAN", "REEFER", "FLATBED", "TANKER", "CONTAINER"] as const;
  const trailers: Trailer[] = [];
  for (let i = 0; i < 16; i++) {
    const type = trailerTypes[i % trailerTypes.length];
    const yard = city("Tashkent");
    const status = i === 15 ? "SHOP" : i === 14 ? "OUT_OF_SERVICE" : i >= 11 ? "YARD" : i >= 9 ? "DROPPED" : "EMPTY";
    const dropCity = city(pick(["Samarkand", "Jizzakh"]));
    const at = status === "DROPPED" ? dropCity : yard;
    trailers.push(await db.trailer.create({
      data: {
        unitNumber: `TR-${String(201 + i)}`, type, year: int(2014, 2024),
        capacityKg: type === "TANKER" ? 30_000 : type === "FLATBED" ? 24_000 : 22_000,
        plate: `01 ${int(100, 999)} ${pick(["XA", "XB"])}`,
        status, statusSince: ago(status === "SHOP" ? 10 : status === "DROPPED" ? int(2, 6) : int(0, 20)),
        truckId: status === "EMPTY" && i < trucks.length ? trucks[i].id : null,
        lat: at.lat + between(-0.02, 0.02), lng: at.lng + between(-0.02, 0.02),
        locationName: status === "DROPPED" ? `${dropCity.name} customer yard` : status === "YARD" || status === "EMPTY" ? "Tashkent yard" : "UzTruck Service",
        gpsProvider: i < 10 ? "Teltonika" : i < 13 ? "Wialon" : null,
        lastPingAt: i < 13 ? new Date(now - int(5, 600) * 60_000) : null,
        insuranceExpiry: new Date(now + int(30, 500) * DAY),
        inspectionExpiry: new Date(now + (i === 4 ? 14 : int(30, 500)) * DAY),
      },
    }));
  }

  // ---------- Customers & brokers ----------
  const customerSeed: [string, string, string, string][] = [
    ["Silk Road Textiles", "Tashkent", "Kamola Rahimova", "SHIPPER"], ["Samarkand Agro Export", "Samarkand", "Ravshan Tojiev", "SHIPPER"],
    ["Fergana Cotton Group", "Fergana", "Laziz Qodirov", "SHIPPER"], ["UzAuto Components", "Andijan", "Oybek Nurmatov", "SHIPPER"],
    ["Navoi Mining Supply", "Navoi", "Gulnora Salieva", "SHIPPER"], ["Almaty Retail Distribution", "Almaty", "Ainur Bekova", "SHIPPER"],
    ["Bishkek Foods LLC", "Bishkek", "Azamat Osmonov", "SHIPPER"], ["Tashkent Pharma", "Tashkent", "Nigora Azimova", "SHIPPER"],
    ["Khorezm Building Materials", "Urgench", "Sanjar Babaev", "SHIPPER"], ["Caspian Chemicals", "Ashgabat", "Merdan Ataev", "SHIPPER"],
    ["Termez Cargo Hub", "Termez", "Shukhrat Olimov", "BOTH"], ["Orient Beverages", "Tashkent", "Madina Khodjaeva", "SHIPPER"],
    ["Silk Route Logistics", "Tashkent", "Jamshid Tashkentov", "BROKER"], ["CentralAsia Freight Exchange", "Almaty", "Dana Serikova", "BROKER"],
    ["Steppe Cargo Brokerage", "Shymkent", "Yerlan Abenov", "BROKER"],
  ];
  const customers: Customer[] = [];
  for (const [name, c, contact, kind] of customerSeed) {
    customers.push(await db.customer.create({
      data: {
        name, kind, city: c, contactName: contact,
        email: `logistics@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
        phone: `+998 71 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`,
        address: `${int(1, 120)} ${pick(["Amir Temur", "Navoi", "Mustaqillik", "Bobur", "Shota Rustaveli"])} str.`,
        country: ({ Almaty: "Kazakhstan", Shymkent: "Kazakhstan", Bishkek: "Kyrgyzstan", Ashgabat: "Turkmenistan" } as Record<string, string>)[c] ?? "Uzbekistan",
        taxId: String(int(300000000, 399999999)),
        paymentTerms: kind === "BROKER" ? pick([30, 45]) : pick([15, 30, 30, 45, 60]),
        creditLimit: pick([25_000, 50_000, 100_000, 150_000]),
      },
    }));
  }
  const shippers = customers.filter((c) => c.kind !== "BROKER");
  const brokers = customers.filter((c) => c.kind !== "SHIPPER");

  // ---------- Loads ----------
  const lanes: [string, string][] = [
    ["Tashkent", "Samarkand"], ["Tashkent", "Almaty"], ["Tashkent", "Bukhara"], ["Fergana", "Tashkent"],
    ["Samarkand", "Termez"], ["Tashkent", "Bishkek"], ["Andijan", "Tashkent"], ["Navoi", "Tashkent"],
    ["Tashkent", "Urgench"], ["Bukhara", "Ashgabat"], ["Tashkent", "Dushanbe"], ["Namangan", "Shymkent"],
    ["Tashkent", "Nukus"], ["Karshi", "Tashkent"], ["Tashkent", "Khujand"], ["Samarkand", "Almaty"],
  ];
  const viaFor: Record<string, string[]> = { Samarkand: ["Jizzakh"], Bukhara: ["Samarkand", "Navoi"], Urgench: ["Bukhara"], Nukus: ["Urgench"], Almaty: ["Shymkent"], Termez: ["Karshi"], Ashgabat: ["Karshi"] };
  const commodities = [
    ["Cotton yarn", "DRY_VAN"], ["Fresh fruit", "REEFER"], ["Auto parts", "DRY_VAN"], ["Steel pipes", "FLATBED"],
    ["Pharmaceuticals", "REEFER"], ["Cement bags", "FLATBED"], ["Beverages", "DRY_VAN"], ["Diesel fuel", "TANKER"],
    ["Consumer electronics", "CONTAINER"], ["Textiles", "DRY_VAN"], ["Frozen poultry", "REEFER"], ["Fertilizer", "DRY_VAN"],
  ] as const;
  const placeNames = { pickup: ["Logistics Park", "Warehouse #2", "Industrial Zone", "Terminal", "DC"], delivery: ["Distribution Center", "Customer Site", "Free Zone", "Warehouse", "Market"] };

  let ref = 10_001;
  type StopSeed = { seq: number; type: string; name: string; city: string; lat: number; lng: number; windowStart: Date | null; windowEnd: Date | null };
  type LoadData = Parameters<typeof db.load.create>[0]["data"];
  type LoadSeed = { data: LoadData & { distanceKm: number; status: string; pickupAt: Date; deliveryAt: Date; departedAt?: Date | null; deliveredAt?: Date | null }; stops: StopSeed[] };
  const loadRows: LoadSeed[] = [];

  // Every dispatched or in-transit load gets its own trailer (one trailer can't be on two trucks); finished loads
  // reuse them. No random draws here, so the rest of the demo stays the same from one reseed to the next.
  const activeTrailers = new Set<string>();
  function trailerFor(equipment: string, active: boolean) {
    const usable = trailers.filter((t) => ["EMPTY", "YARD", "DROPPED"].includes(t.status) && !(active && activeTrailers.has(t.id)));
    const trailer = usable.find((t) => t.type === equipment) ?? usable[0] ?? trailers[0];
    if (active) activeTrailers.add(trailer.id);
    return trailer;
  }

  function makeLoad(status: string, pickupAt: Date, truckIdx: number | null): LoadSeed {
    const [o, d] = pick(lanes);
    const origin = city(o), dest = city(d);
    const [commodity, equipment] = pick(commodities);
    const truck = truckIdx !== null ? trucks[truckIdx] : null;
    const driver = truck?.driverId ? drivers.find((x) => x.id === truck.driverId)! : null;
    const trailer = truckIdx !== null ? trailerFor(equipment, status === "IN_TRANSIT" || status === "ASSIGNED") : null;
    // Stops: pickup, optional intermediate delivery, final delivery
    const points = [origin];
    const via = viaFor[d];
    if (via && chance(0.3)) points.push(city(pick(via)));
    points.push(dest);
    const distanceKm = routeKm(points);
    const hours = distanceKm / AVG_SPEED;
    const deliveryAt = new Date(pickupAt.getTime() + (hours + int(4, 20)) * HOUR);
    const stops: StopSeed[] = points.map((p, i) => ({
      seq: i + 1,
      type: i === 0 ? "PICKUP" : "DELIVERY",
      name: `${p.name} ${pick(i === 0 ? placeNames.pickup : placeNames.delivery)}`,
      city: p.name, lat: p.lat, lng: p.lng,
      windowStart: i === 0 ? pickupAt : i < points.length - 1 ? new Date(pickupAt.getTime() + hours * HOUR * 0.55) : null,
      windowEnd: i === 0 ? new Date(pickupAt.getTime() + 2 * HOUR) : i < points.length - 1 ? new Date(pickupAt.getTime() + hours * HOUR * 0.55 + 3 * HOUR) : deliveryAt,
    }));
    const rate = Math.round((distanceKm * between(1.35, 2.1) + 150) / 10) * 10;
    const departedAt = ["IN_TRANSIT", "DELIVERED", "INVOICED"].includes(status) ? new Date(pickupAt.getTime() + int(0, 90) * 60_000) : null;
    const deliveredAt = departedAt && status !== "IN_TRANSIT"
      ? new Date(departedAt.getTime() + hours * HOUR * between(0.9, 1.25) + (chance(0.12) ? int(20, 40) * HOUR : 0)) : null; // ~12% late
    const driverPay = driver ? Math.round(distanceKm * driver.payPerKm) : 0;
    const broker = chance(0.4) ? pick(brokers) : null;
    const customer = pick(shippers.filter((c) => c.id !== broker?.id));
    return {
      data: {
        reference: `LD-${ref++}`,
        customerId: customer.id,
        brokerId: broker?.id ?? null,
        customerRef: chance(0.6) ? `${pick(["PO", "REF", "BK"])}-${int(10000, 99999)}` : null,
        teamId: driver?.teamId ?? null,
        status,
        priority: pick(["NORMAL", "NORMAL", "NORMAL", "HIGH", "LOW", "URGENT"]),
        originName: stops[0].name, originCity: o, originLat: origin.lat, originLng: origin.lng,
        destName: stops[stops.length - 1].name, destCity: d, destLat: dest.lat, destLng: dest.lng,
        pickupAt, deliveryAt, distanceKm, emptyKm: int(0, 12) * 10,
        commodity, equipment,
        weightKg: int(6, 22) * 1000,
        pallets: equipment === "TANKER" ? null : int(10, 33),
        temperatureC: equipment === "REEFER" ? pick([-18, 2, 4]) : null,
        hazmat: commodity === "Diesel fuel",
        rate, driverPay,
        fuelCost: Math.round(distanceKm * 0.32 * 0.95),
        otherCost: int(0, 3) * 25,
        truckId: truck?.id ?? null, trailerId: trailer?.id ?? null, driverId: driver?.id ?? null,
        dispatcherId: driver ? dispatchers.find((u) => u.teamId === driver.teamId)?.id ?? pick(dispatchers).id : pick(dispatchers).id,
        departedAt, deliveredAt,
        podSignedBy: deliveredAt ? pick(["A. Karimov", "Warehouse mgr", "S. Ivanova", "Security desk"]) : null,
        createdAt: new Date(Math.min(pickupAt.getTime() - 2 * DAY, now - int(30, 900) * 60_000)),
      },
      stops,
    };
  }

  // History: ~6 months of completed work
  for (let d = 180; d > 3; d -= between(1.2, 2.4)) {
    loadRows.push(makeLoad(d > 20 ? "INVOICED" : pick(["DELIVERED", "INVOICED"]), ago(d), int(0, 11)));
  }
  // Currently in transit on trucks 0..7 (mid-route)
  for (let i = 0; i < 8; i++) {
    const l = makeLoad("IN_TRANSIT", new Date(), i);
    const hours = l.data.distanceKm / AVG_SPEED;
    const departed = new Date(now - hours * between(0.12, 0.85) * HOUR);
    l.data.departedAt = departed;
    l.data.pickupAt = new Date(departed.getTime() - 30 * 60_000);
    l.data.deliveryAt = new Date(departed.getTime() + (hours + int(2, 10)) * HOUR);
    l.stops[0].windowStart = l.data.pickupAt; l.stops[0].windowEnd = departed;
    l.stops[l.stops.length - 1].windowEnd = l.data.deliveryAt;
    loadRows.push(l);
  }
  // Dispatched (upcoming) on trucks 8..10
  for (let i = 8; i < 11; i++) loadRows.push(makeLoad("ASSIGNED", new Date(now + between(3, 30) * HOUR), i));
  // Booked backlog (some > 24h out → prebook)
  for (let i = 0; i < 7; i++) loadRows.push(makeLoad("PLANNED", new Date(now + between(8, 120) * HOUR), null));
  loadRows.push(makeLoad("CANCELLED", ago(6), null));
  { const t = makeLoad("TONU", ago(10), 9); t.data.rate = 150; t.data.truckId = null; t.data.driverId = null; t.data.trailerId = null; loadRows.push(t); }

  const loads: Awaited<ReturnType<typeof createLoad>>[] = [];
  async function createLoad(row: LoadSeed) {
    const { data, stops } = row;
    const progress = data.status === "IN_TRANSIT" && data.departedAt ? (now - data.departedAt.getTime()) / ((data.distanceKm / AVG_SPEED) * HOUR) : 0;
    const done = ["DELIVERED", "INVOICED"].includes(data.status);
    const stopsData = stops.map((st, i) => {
      const isLast = i === stops.length - 1;
      // in transit: pickup done; intermediate delivery done once past 55% of the trip; final pending
      let status = "PENDING", arrivedAt: Date | null = null, departedAt: Date | null = null;
      if (done || data.status === "IN_TRANSIT") {
        if (i === 0) { status = "DONE"; arrivedAt = data.pickupAt; departedAt = data.departedAt ?? arrivedAt; }
        else if (done || (!isLast && progress > 0.55)) { status = "DONE"; arrivedAt = new Date(data.departedAt!.getTime() + (data.distanceKm / AVG_SPEED) * HOUR * (isLast ? 1 : 0.55)); departedAt = new Date(arrivedAt.getTime() + 90 * 60_000); }
        else if (!isLast && progress > 0.5) { status = "ARRIVED"; arrivedAt = new Date(now - 20 * 60_000); }
      }
      if (done && isLast && data.deliveredAt) { arrivedAt = data.deliveredAt; departedAt = new Date(data.deliveredAt.getTime() + 60 * 60_000); }
      return { ...st, status, arrivedAt, departedAt };
    });
    return db.load.create({ data: { ...data, stops: { create: stopsData } }, include: { stops: { orderBy: { seq: "asc" } } } });
  }
  for (const row of loadRows) loads.push(await createLoad(row));

  // Trailers on active loads are IN_USE and travel with the tractor
  for (const l of loads) {
    if (["ASSIGNED", "IN_TRANSIT"].includes(l.status) && l.trailerId) {
      // Hooked an hour before pickup, or an hour ago for a pickup still ahead (never in the future).
      await db.trailer.update({ where: { id: l.trailerId }, data: { status: "IN_USE", statusSince: new Date(Math.min(now, l.pickupAt.getTime()) - HOUR), truckId: l.truckId } });
    }
  }

  // Truck positions along multi-stop routes
  for (const l of loads) {
    if (l.status === "IN_TRANSIT" && l.truckId && l.departedAt) {
      const t = (now - l.departedAt.getTime()) / ((l.distanceKm / AVG_SPEED) * HOUR);
      const route = pathPolyline(l.stops.map((st) => ({ lat: st.lat, lng: st.lng })));
      const p = pointAlongPolyline(route, t);
      await db.truck.update({ where: { id: l.truckId }, data: { lat: p.lat, lng: p.lng, speedKmh: 70, engineOn: true, fuelPct: Math.max(10, Math.round(92 - t * (l.distanceKm / 9))), locationName: nearestCity(p.lat, p.lng).label, lastPingAt: new Date() } });
      if (l.trailerId) await db.trailer.update({ where: { id: l.trailerId }, data: { lat: p.lat, lng: p.lng, locationName: nearestCity(p.lat, p.lng).label, lastPingAt: new Date() } });
    }
    if (l.status === "ASSIGNED" && l.truckId) {
      const s0 = l.stops[0];
      await db.truck.update({ where: { id: l.truckId }, data: { lat: s0.lat + 0.01, lng: s0.lng + 0.01, locationName: nearestCity(s0.lat, s0.lng).label } });
    }
  }

  // Board statuses (derived) + history
  for (const d of drivers) {
    const active = loads.find((l) => l.driverId === d.id && ["IN_TRANSIT", "ASSIGNED"].includes(l.status));
    let board = "READY", manual = false;
    if (active?.status === "ASSIGNED") board = "DISPATCHED";
    if (active?.status === "IN_TRANSIT") {
      const cur = active.stops.find((st) => st.status !== "DONE");
      board = cur?.status === "ARRIVED" ? (cur.type === "PICKUP" ? "AT_PICKUP" : "UNLOADING") : "EN_ROUTE";
    }
    if (d.status === "ON_LEAVE") { board = "VACATION"; manual = true; }
    if (d.name === "Javlon Normatov") { board = "HOME"; manual = true; }
    if (d.name === "Eldor Qosimov" && !active) { board = "REST"; manual = true; }
    const sinceRaw = active?.departedAt ?? active?.pickupAt ?? ago(between(0.2, 2.5));
    const since = sinceRaw > new Date() ? new Date() : sinceRaw;
    await db.driver.update({ where: { id: d.id }, data: { boardStatus: board, boardStatusSince: since, boardStatusManual: manual } });
    const history = [["READY", 3.2], ["DISPATCHED", 2.4], ["EN_ROUTE", 2.1], ["READY", 1.1]] as const;
    for (const [st, daysAgo] of history) await db.driverStatusEvent.create({ data: { driverId: d.id, status: st, source: "AUTO", at: ago(daysAgo + between(0, 0.3)) } });
    await db.driverStatusEvent.create({ data: { driverId: d.id, status: board, source: manual ? "MANUAL" : "AUTO", at: since, userId: manual ? dispatchers[0].id : null, note: manual && board === "HOME" ? "Family matter — back Monday" : null } });
  }

  // Board annotations for today
  const today = new Date(new Date().toISOString().slice(0, 10));
  const notes = ["Call before 09:00 — gate closes early", "Needs trailer swap in Jizzakh", "Customs docs with driver", "Reefer at 2°C — check at pickup"];
  for (const [i, note] of notes.entries()) {
    await db.boardCell.create({ data: { date: today, driverId: drivers[i].id, column: "notes", note, updatedById: dispatchers[i % 2].id } });
  }
  await db.boardCell.create({ data: { date: today, driverId: drivers[1].id, column: "row", color: "amber", updatedById: dispatchers[0].id } });
  await db.boardCell.create({ data: { date: today, driverId: drivers[4].id, column: "row", color: "green", updatedById: dispatchers[0].id } });
  await db.boardCell.create({ data: { date: today, driverId: drivers[7].id, column: "row", color: "red", updatedById: dispatchers[1].id } });

  // Events timeline
  const clamp = (d: Date) => new Date(Math.min(d.getTime(), now - int(5, 600) * 60_000));
  for (const l of loads) {
    const ev: { type: string; message: string; createdAt: Date; userId?: string }[] = [
      { type: "CREATED", message: `Load created for ${l.commodity} (${l.stops.length} stops)`, createdAt: new Date(l.pickupAt.getTime() - 2 * DAY), userId: l.dispatcherId ?? undefined },
    ];
    if (l.truckId) ev.push({ type: "ASSIGNED", message: "Truck, trailer and driver assigned", createdAt: new Date(l.pickupAt.getTime() - DAY), userId: l.dispatcherId ?? undefined });
    if (l.departedAt) ev.push({ type: "STATUS", message: `Picked up at ${l.originName} — in transit`, createdAt: l.departedAt });
    if (l.status === "IN_TRANSIT") ev.push({ type: "CHECK_CALL", message: pick(["Driver check-in: road clear, on schedule", "Driver check-in: 40 min queue at the border", "Driver check-in: fuel stop, back on route"]), createdAt: new Date(now - int(10, 120) * 60_000) });
    if (l.deliveredAt) ev.push({ type: "STATUS", message: `Delivered. POD signed by ${l.podSignedBy}`, createdAt: l.deliveredAt });
    if (l.status === "CANCELLED") ev.push({ type: "STATUS", message: "Cancelled by customer", createdAt: new Date(l.pickupAt.getTime() - 12 * HOUR) });
    if (l.status === "TONU") ev.push({ type: "STATUS", message: "Truck ordered, not used — shipper cancelled at the dock; TONU fee agreed", createdAt: new Date(l.pickupAt.getTime() + HOUR) });
    await db.loadEvent.createMany({ data: ev.map((e) => ({ ...e, createdAt: clamp(e.createdAt), loadId: l.id })) });
  }

  // Load documents (RC / BOL / POD) for completed work; a few are missing so the billing queue has content
  const uploader = () => pick([byRole("ACCOUNTANT").id, ...dispatchers.map((d) => d.id)]);
  for (const l of loads) {
    const completed = ["DELIVERED", "INVOICED", "TONU"].includes(l.status);
    const kinds: string[] = [];
    if (completed || l.status === "IN_TRANSIT" || l.status === "ASSIGNED") { if (chance(0.88)) kinds.push("RC"); }
    if (completed && l.status !== "TONU") { if (chance(0.85)) kinds.push("BOL"); if (l.status === "INVOICED" || chance(0.5)) kinds.push("POD"); }
    for (const k of kinds) {
      await db.document.create({ data: { kind: k, name: `${k}_${l.reference}.pdf`, storageKey: seedKey(`load/${l.id}`, `${k}_${l.reference}`), contentType: "application/pdf", size: int(80_000, 900_000), loadId: l.id, uploadedById: k === "POD" ? drivers.find((d) => d.id === l.driverId)?.userId ?? uploader() : uploader(), createdAt: clamp(new Date((l.deliveredAt ?? l.pickupAt).getTime() + int(1, 30) * HOUR)) } });
    }
  }

  // Invoices (bill the broker when there is one)
  let inv = 5001;
  for (const l of loads.filter((x) => x.status === "INVOICED")) {
    const c = customers.find((x) => x.id === (l.brokerId ?? l.customerId))!;
    const issuedAt = new Date(l.deliveredAt!.getTime() + DAY);
    const dueAt = new Date(issuedAt.getTime() + c.paymentTerms * DAY);
    const age = (now - issuedAt.getTime()) / DAY;
    const paid = age > c.paymentTerms * 1.6 ? chance(0.97) : age > c.paymentTerms * 0.7 && chance(0.7);
    await db.invoice.create({
      data: {
        number: `INV-${inv++}`, customerId: c.id, loadId: l.id, amount: l.rate,
        status: paid ? "PAID" : "SENT", issuedAt, dueAt,
        paidAt: paid ? new Date(Math.min(now, issuedAt.getTime() + between(0.5, 1.1) * c.paymentTerms * DAY)) : null,
      },
    });
    await db.load.update({ where: { id: l.id }, data: { billingStage: paid ? "PAID" : "INVOICED" } });
  }
  // Billing stage for delivered / TONU loads
  for (const l of loads.filter((x) => ["DELIVERED", "TONU"].includes(x.status))) {
    const kinds = new Set((await db.document.findMany({ where: { loadId: l.id }, select: { kind: true } })).map((d) => d.kind));
    await db.load.update({ where: { id: l.id }, data: { billingStage: kinds.has("RC") && kinds.has("POD") ? "READY_TO_INVOICE" : "MISSING_DOCS" } });
  }

  // Unit & people compliance documents
  for (const [i, t] of trucks.entries()) {
    const have = i % 4 === 3 ? ["REGISTRATION", "INSURANCE"] : i % 7 === 6 ? [] : ["REGISTRATION", "INSURANCE", "INSPECTION"];
    for (const k of have) {
      const exp = k === "INSURANCE" ? t.insuranceExpiry : k === "INSPECTION" ? t.inspectionExpiry : t.registrationExpiry;
      await db.document.create({ data: { kind: k, name: `${t.unitNumber}_${k.toLowerCase()}.pdf`, storageKey: seedKey(`truck/${t.id}`, `${t.unitNumber}_${k}`), contentType: "application/pdf", size: int(120_000, 600_000), truckId: t.id, expiresAt: exp, uploadedById: byRole("FLEET_MANAGER").id, createdAt: ago(int(10, 300)) } });
    }
  }
  for (const [i, t] of trailers.entries()) {
    const have = i % 5 === 4 ? ["REGISTRATION"] : i % 7 === 6 ? [] : ["REGISTRATION", "INSURANCE", "INSPECTION"];
    for (const k of have) {
      const exp = k === "INSURANCE" ? t.insuranceExpiry : k === "INSPECTION" ? t.inspectionExpiry : new Date(now + int(60, 700) * DAY);
      await db.document.create({ data: { kind: k, name: `${t.unitNumber}_${k.toLowerCase()}.pdf`, storageKey: seedKey(`trailer/${t.id}`, `${t.unitNumber}_${k}`), contentType: "application/pdf", size: int(100_000, 500_000), trailerId: t.id, expiresAt: exp, uploadedById: byRole("FLEET_MANAGER").id, createdAt: ago(int(10, 300)) } });
    }
  }
  for (const [i, d] of drivers.entries()) {
    if (i % 5 !== 4) await db.document.create({ data: { kind: "LICENSE", name: `${d.name.replace(" ", "_")}_licence.pdf`, storageKey: seedKey(`driver/${d.id}`, "licence"), contentType: "application/pdf", size: int(90_000, 300_000), driverId: d.id, expiresAt: d.licenseExpiry, uploadedById: byRole("FLEET_MANAGER").id, createdAt: ago(int(10, 400)) } });
    if (i % 3 !== 2) await db.document.create({ data: { kind: "MEDICAL", name: `${d.name.replace(" ", "_")}_medical.pdf`, storageKey: seedKey(`driver/${d.id}`, "medical"), contentType: "application/pdf", size: int(90_000, 300_000), driverId: d.id, expiresAt: d.medicalExpiry, uploadedById: byRole("FLEET_MANAGER").id, createdAt: ago(int(10, 400)) } });
  }
  for (const b of brokers) await db.document.create({ data: { kind: "CONTRACT", name: `Carrier_agreement_${b.name.replace(/\s+/g, "_")}.pdf`, storageKey: seedKey(`customer/${b.id}`, "carrier_agreement"), contentType: "application/pdf", size: int(200_000, 800_000), customerId: b.id, uploadedById: byRole("ACCOUNTANT").id, createdAt: ago(int(30, 400)) } });
  for (const [k, name, exp] of [["COMPANY_LICENSE", "International_haulage_licence", 420], ["COMPANY_INSURANCE", "CMR_liability_insurance", 200], ["TAX_CERT", "Tax_registration_certificate", null]] as const) {
    await db.document.create({ data: { kind: k, name: `${name}.pdf`, storageKey: seedKey("company", name), contentType: "application/pdf", size: int(200_000, 900_000), isCompany: true, expiresAt: exp ? new Date(now + exp * DAY) : null, uploadedById: byRole("ADMIN").id, createdAt: ago(int(30, 300)) } });
  }

  // Work orders & fuel
  const woSeed = [
    ["PM", "Engine oil & filters", 420, 180], ["TIRES", "Replace steer tires", 980, 120], ["INSPECTION", "Annual technical inspection", 60, 90],
    ["BRAKES", "Brake pads & discs", 640, 260], ["PM", "Full PM service", 700, 300], ["ENGINE", "Air compressor replacement", 1200, 380],
    ["COOLING", "Radiator hose & coolant", 210, 140], ["ELECTRICAL", "Alternator replacement", 540, 220], ["BODY", "Mirror & step repair", 160, 90],
  ] as const;
  const vendors = ["UzTruck Service", "Volvo Center Tashkent", "MAN Service Chirchiq", "In-house workshop"];
  for (const t of trucks) {
    for (let k = 0; k < int(2, 5); k++) {
      const [category, title, parts, labor] = pick(woSeed);
      const inAt = ago(int(5, 170));
      const outAt = new Date(inAt.getTime() + int(4, 72) * HOUR);
      await db.workOrder.create({ data: { truckId: t.id, title, category, status: "DONE", priority: pick(["LOW", "MEDIUM", "MEDIUM", "HIGH"]), scheduledAt: inAt, inAt, outAt, completedAt: outAt, partsCost: parts, laborCost: labor, cost: parts + labor, vendor: pick(vendors), odometerKm: t.odometerKm - int(1000, 30000), createdById: byRole("FLEET_MANAGER").id, createdAt: inAt } });
    }
    if (chance(0.5)) {
      const [category, title, parts, labor] = pick(woSeed);
      await db.workOrder.create({ data: { truckId: t.id, title, category, status: "OPEN", priority: pick(["LOW", "MEDIUM", "HIGH"]), scheduledAt: new Date(now + int(1, 25) * DAY), partsCost: parts, laborCost: labor, cost: parts + labor, vendor: "UzTruck Service", createdById: byRole("FLEET_MANAGER").id } });
    }
    for (let k = 0; k < 10; k++) {
      const liters = int(180, 520);
      await db.fuelLog.create({ data: { truckId: t.id, driverId: t.driverId, liters, cost: Math.round(liters * between(0.9, 1.05)), station: pick(["UzGasOil #14", "Lukoil M39", "Saneg A-380", "Mustang Fuel"]), date: ago(int(1, 120)), odometerKm: t.odometerKm - int(500, 20000) } });
    }
  }
  await db.workOrder.create({ data: { truckId: trucks[12].id, title: "Gearbox overhaul", description: "Hard shifting 3→4, metal in the oil. Full overhaul with new synchros.", category: "ENGINE", status: "IN_PROGRESS", priority: "HIGH", scheduledAt: ago(2), inAt: ago(2), partsCost: 2600, laborCost: 1200, cost: 3800, vendor: "Scania Service Tashkent", odometerKm: trucks[12].odometerKm, createdById: byRole("FLEET_MANAGER").id } });
  await db.workOrder.create({ data: { trailerId: trailers[15].id, title: "Rear door hinge & seal", category: "BODY", status: "IN_PROGRESS", priority: "MEDIUM", scheduledAt: ago(10), inAt: ago(10), partsCost: 260, laborCost: 180, cost: 440, vendor: "UzTruck Service", createdById: byRole("FLEET_MANAGER").id } });
  await db.workOrder.create({ data: { truckId: trucks[3].id, title: "Check DPF warning light", category: "ENGINE", status: "DRAFT", priority: "MEDIUM", scheduledAt: new Date(now + 3 * DAY), createdById: byRole("FLEET_MANAGER").id } });

  // Claims
  const delivered = loads.filter((l) => ["DELIVERED", "INVOICED"].includes(l.status));
  const claimSeed: { type: string; severity: string; status: string; daysAgo: number; fault: string; amount: number; settled?: number; desc: string }[] = [
    { type: "CARGO_DAMAGE", severity: "HIGH", status: "UNDER_REVIEW", daysAgo: 6, fault: "UNKNOWN", amount: 2400, desc: "Four pallets of beverages crushed on arrival; load shift suspected. Photos taken at unloading." },
    { type: "LATE_CARGO", severity: "LOW", status: "DENIED", daysAgo: 40, fault: "THIRD_PARTY", amount: 350, desc: "Consignee charged a late fee; delay caused by a 6-hour border closure (documented)." },
    { type: "EQUIPMENT_DAMAGE", severity: "MEDIUM", status: "PAID", daysAgo: 55, fault: "THIRD_PARTY", amount: 1800, settled: 1650, desc: "Trailer side panel damaged by a forklift at the customer's warehouse." },
    { type: "ACCIDENT", severity: "CRITICAL", status: "NEGOTIATION", daysAgo: 21, fault: "SHARED", amount: 9500, desc: "Minor collision at a roundabout near Jizzakh; no injuries. Front bumper and headlight replaced." },
    { type: "OSD", severity: "LOW", status: "REPORTED", daysAgo: 1, fault: "UNKNOWN", amount: 0, desc: "Consignee reports 2 cartons short against the BOL count." },
    { type: "CARGO_LOSS", severity: "HIGH", status: "SUBMITTED", daysAgo: 12, fault: "OURS", amount: 4100, desc: "Reefer temperature excursion overnight; 1.2 t of frozen poultry rejected." },
    { type: "OTHER", severity: "LOW", status: "CLOSED", daysAgo: 70, fault: "OURS", amount: 120, desc: "Lost customs seal; replacement and re-inspection fee." },
  ];
  let clm = 1001;
  for (const c of claimSeed) {
    const l = pick(delivered);
    const claim = await db.claim.create({
      data: {
        number: `CLM-${clm++}`, type: c.type, severity: c.severity, status: c.status, fault: c.fault,
        incidentAt: ago(c.daysAgo + 0.5), location: l.destName, description: c.desc,
        amountClaimed: c.amount, amountSettled: c.settled ?? (c.status === "DENIED" ? 0 : null),
        driverId: l.driverId, loadId: l.id, truckId: l.truckId, trailerId: l.trailerId, customerId: l.brokerId ?? l.customerId,
        assignedToId: c.type === "ACCIDENT" || c.type === "EQUIPMENT_DAMAGE" ? byRole("FLEET_MANAGER").id : byRole("ACCOUNTANT").id,
        createdById: pick(dispatchers).id, createdAt: ago(c.daysAgo), closedAt: ["PAID", "CLOSED", "DENIED"].includes(c.status) ? ago(Math.max(0.1, c.daysAgo - int(5, 15))) : null,
      },
    });
    await db.claimNote.create({ data: { claimId: claim.id, userId: pick(dispatchers).id, body: "Driver statement collected; photos uploaded.", createdAt: ago(Math.max(0.1, c.daysAgo - 0.3)) } });
    if (["NEGOTIATION", "SUBMITTED", "PAID"].includes(c.status)) await db.claimNote.create({ data: { claimId: claim.id, userId: byRole("ACCOUNTANT").id, body: "Claim pack sent to the insurer; awaiting adjuster response.", createdAt: ago(Math.max(0.2, c.daysAgo - 3)) } });
    if (c.type !== "OTHER") await db.document.create({ data: { kind: "CLAIM_PHOTO", name: `${claim.number}_photos.pdf`, storageKey: seedKey(`claim/${claim.id}`, "photos"), contentType: "application/pdf", size: int(400_000, 2_500_000), claimId: claim.id, uploadedById: pick(dispatchers).id, createdAt: ago(Math.max(0.1, c.daysAgo - 0.2)) } });
  }

  // Chat & announcements
  const inTransit = loads.filter((l) => l.status === "IN_TRANSIT");
  const chat: [string, string, number][] = [
    ["OWNER", "Morning all. Border at Oybek is slow again — plan 2–3 h extra on anything heading to Khujand.", 2.9],
    ["DISPATCHER", `Noted. ${inTransit[0]?.reference ?? "LD-10101"} already crossed at 05:40, driver says the queue is on the KZ side.`, 2.85],
    ["FLEET_MANAGER", "T-113 gearbox is out, parts arrive Thursday. Don't plan it before Friday.", 2.7],
    ["DISPATCHER", "Anyone free for Tashkent → Almaty tomorrow 06:00? Silk Route offering 1,700.", 2.1],
    ["DISPATCHER", "Bobur can take it if the reefer TR-203 is back from Jizzakh.", 2.0],
    ["ACCOUNTANT", "Reminder: 6 delivered loads still missing PODs. Can't invoice without them.", 1.6],
    ["DISPATCHER", "Chasing drivers now, photos coming through the app.", 1.55],
    ["OWNER", "Nice week so far — on-time is back above 90%.", 1.2],
    ["FLEET_MANAGER", "Winter tyres: fitting starts next Monday, two trucks per day. Schedule around it.", 0.9],
    ["DISPATCHER", "Steppe Cargo wants a quote for Shymkent → Nukus weekly. Thoughts on rate?", 0.5],
    ["OWNER", "Start at 2.0/km, floor 1.75. Empty return is the problem.", 0.45],
    ["ACCOUNTANT", "INV-5090 paid today. 3 overdue left, I'll call them this afternoon.", 0.2],
  ];
  for (const [role, body, daysAgo] of chat) {
    const author = role === "DISPATCHER" ? pick(dispatchers) : byRole(role);
    await db.chatMessage.create({ data: { room: "company", userId: author.id, body, createdAt: ago(daysAgo) } });
  }
  for (const l of inTransit.slice(0, 2)) {
    const drvUser = drivers.find((d) => d.id === l.driverId)?.userId;
    await db.chatMessage.create({ data: { room: `load:${l.id}`, userId: l.dispatcherId, body: "Call me when you're 1 hour out, I'll warn the consignee.", createdAt: ago(0.4) } });
    if (drvUser) await db.chatMessage.create({ data: { room: `load:${l.id}`, userId: drvUser, body: "Ok. Roads clear, no issues.", createdAt: ago(0.35) } });
  }
  await db.announcement.create({ data: { title: "Border crossing Oybek: expect 2–3 h queues this week", body: "Kazakh customs are running reduced shifts until Sunday. Add the extra time to ETAs and tell consignees early. Drivers: keep the CMR and customs declaration on top.", pinned: true, authorId: byRole("OWNER").id, createdAt: ago(2.95) } });
  await db.announcement.create({ data: { title: "Winter tyres from Monday", body: "Fitting at UzTruck Service, two trucks per day. Fleet will post the schedule on the board. Loads already dispatched won't be touched.", pinned: true, authorId: byRole("FLEET_MANAGER").id, createdAt: ago(0.9) } });
  await db.announcement.create({ data: { title: "New: Telegram alerts", body: "Link your Telegram under My account to get your alerts on the phone.", pinned: false, authorId: byRole("ADMIN").id, createdAt: ago(5) } });

  // Settings
  await db.appSetting.createMany({
    data: [
      { key: "company.profile", value: JSON.stringify({ legalName: "FleetOps Logistics LLC", brand: "FleetOps", taxId: "305 123 456", licenseNumber: "UZ-TR-2021-0456", director: "Kamron Rakhimov", phone: "+998 71 200 10 10", email: "ops@fleetops.example", address: "12 Amir Temur str., Tashkent 100000, Uzbekistan", bank: { name: "Kapitalbank", account: "2020 8000 1234 5678 9012", mfo: "01088", swift: "KACHUZ22" }, insurance: { carrier: "Uzbekinvest", policy: "CMR-2026-00419", agent: "Nilufar Yuldasheva, +998 90 123 45 67" } }) },
      { key: "weekly.goalSolo", value: "5000" },
      { key: "weekly.goalTeam", value: "7500" },
    ],
  });

  await db.auditLog.create({ data: { userId: users[0].id, action: "seed", entity: "system", details: "Demo data loaded (v2)" } });

  console.log(`Seeded ${users.length + drivers.length} users, ${teams.length} teams, ${trucks.length} trucks, ${trailers.length} trailers, ${customers.length} customers/brokers, ${loads.length} loads, ${claimSeed.length} claims.`);
  if (!process.env.DEMO_PASSWORD) console.log(`All demo accounts use password: ${DEMO_PASSWORD}`);
  else console.log("All demo accounts use the DEMO_PASSWORD you provided.");
}

main().finally(() => db.$disconnect());
