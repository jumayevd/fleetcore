import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { rootDb } from "@/lib/db-root";
import { SILK_ROAD_SPEC, seedCompany } from "./fleet-data";
import { DEMO_EMAIL, DEMO_OWNER_EMAIL } from "./shared";

/*
 * The live demo (/demo on the public site): anyone can open a made-up fleet without an account and try FleetCore.
 *
 *  - One demo company, rebuilt from scratch every night (/api/cron/demo) so whatever visitors change is gone by morning.
 *  - Visitors all sign in as the same account (DEMO_EMAIL) with the Specialist role: they can add and edit trucks,
 *    repairs, defects and papers, but can't invite people, change company settings or delete the company.
 *  - That account can't change its password or profile, connect a mailbox or use the AI assistant (see isDemoEmail).
 *  - Off unless DEMO_ENABLED=true, so a fresh install never writes demo data into its database by surprise.
 *
 * Neither demo account has a known password: nobody can sign in to them on the login page.
 */

export const isDemoEnabled = () => process.env.DEMO_ENABLED === "true";

const DEMO_COMPANY = "Demo Freight Co.";

async function demoAccount(email: string, name: string) {
  const existing = await rootDb.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing;
  const [firstName, ...rest] = name.split(" ");
  return rootDb.user.create({
    data: {
      email, name, firstName, lastName: rest.join(" "), idNumber: "DEMO", birthDate: new Date(Date.UTC(1990, 0, 1)),
      passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 10),
    },
    select: { id: true },
  });
}

/** The current demo company (the newest, should two rebuilds ever overlap). */
export async function findDemoCompany() {
  return rootDb.company.findFirst({
    where: { memberships: { some: { user: { email: DEMO_OWNER_EMAIL } } } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/** Throw the demo company away and build a fresh one. Returns the new company and the visitor account. */
export async function resetDemo() {
  const owner = await demoAccount(DEMO_OWNER_EMAIL, "Jordan Miller");
  const visitor = await demoAccount(DEMO_EMAIL, "Demo Visitor");
  const old = await rootDb.company.findMany({ where: { memberships: { some: { userId: owner.id } } }, select: { id: true } });
  const built = await seedCompany(rootDb, {
    ...SILK_ROAD_SPEC,
    name: DEMO_COMPANY,
    profile: { ...SILK_ROAD_SPEC.profile, legalName: "Demo Freight Co.", director: "Jordan Miller", email: "fleet@demofreight.example" },
  }, { owner: owner.id, members: [{ userId: visitor.id, role: "SPECIALIST", lastActiveDays: 0.01 }] });
  // Deleting a company removes everything it owns (the audit log keeps its entries, as for any company).
  if (old.length) await rootDb.company.deleteMany({ where: { id: { in: old.map((c) => c.id) } } });
  return { companyId: built.companyId, visitorId: visitor.id, trucks: built.trucks, workOrders: built.workOrders };
}

/** The demo to open right now: the existing one, or a first one built on the spot. */
export async function demoWorkspace() {
  const [company, visitor] = await Promise.all([findDemoCompany(), rootDb.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } })]);
  if (company && visitor) return { companyId: company.id, visitorId: visitor.id };
  const fresh = await resetDemo();
  return { companyId: fresh.companyId, visitorId: fresh.visitorId };
}
