"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { CUSTOMER_KINDS, DRIVER_STATUSES, DRIVER_TYPES, ROLES } from "@/lib/constants";
import { syncDriverBoardStatus } from "@/lib/workflow";

/* ------------------------------------------------------------------ */
/* Drivers                                                             */
/* ------------------------------------------------------------------ */

/** Board status that goes with an employment status off duty: on leave → Vacation, inactive → Home. */
const offDutyBoard = (status: string) => (status === "ON_LEAVE" ? "VACATION" : "HOME");

/** Park an off-duty driver on the board (a manual status, so loads don't override it) and log it in the history. */
async function parkOffDuty(driverId: string, status: string, userId: string) {
  const board = offDutyBoard(status);
  await db.driver.update({ where: { id: driverId }, data: { boardStatus: board, boardStatusSince: new Date(), boardStatusManual: true } });
  await db.driverStatusEvent.create({ data: { driverId, status: board, source: "MANUAL", userId, note: status === "ON_LEAVE" ? "On leave" : "Inactive" } });
}

/** A driver's employment can only change off duty once they are off their loads. */
async function assertOffLoads(driverId: string, name: string) {
  const busy = await db.load.findFirst({ where: { driverId, status: { in: ["ASSIGNED", "IN_TRANSIT"] } }, orderBy: { pickupAt: "asc" }, select: { reference: true } });
  if (busy) throw new FormError(`${name} is on ${busy.reference}. Recover the load to another driver first.`);
}

export async function saveDriver(driverId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("drivers.edit");
  let id = driverId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const licenseExpiry = f.date("licenseExpiry");
    if (!licenseExpiry) throw new FormError("Licence expiry is required");
    const status = f.str("status") ?? "ACTIVE";
    const type = f.str("type") ?? "COMPANY";
    if (!DRIVER_STATUSES.includes(status as never)) throw new FormError("Invalid status");
    if (!DRIVER_TYPES.includes(type as never)) throw new FormError("Invalid driver type");
    const data = {
      name: f.req("name", "Name"),
      phone: f.str("phone"),
      phone2: f.str("phone2"),
      email: f.str("email")?.toLowerCase() ?? null,
      licenseNumber: f.req("licenseNumber", "Licence number"),
      licenseClass: f.str("licenseClass") ?? "CE",
      licenseExpiry,
      medicalExpiry: f.date("medicalExpiry"),
      hireDate: f.date("hireDate") ?? new Date(),
      payPerKm: f.num("payPerKm") ?? 0.35,
      status, type,
      teamId: f.str("teamId"),
      hold: f.bool("hold"),
      holdReason: f.bool("hold") ? f.str("holdReason") : null,
      notes: f.str("notes"),
    };
    // A password creates the driver's app login, on a new profile or on one that has none yet.
    const password = f.str("password");
    if (password && password.length < 8) throw new FormError("Password must be at least 8 characters");
    const createLogin = async () => {
      if (!data.email) throw new FormError("Email is required to create an app login");
      const u = await db.user.create({
        data: { name: data.name, email: data.email, phone: data.phone, role: "DRIVER", passwordHash: await bcrypt.hash(password!, 10) },
      });
      await audit(me.id, "create", "user", u.id, `${u.email} as DRIVER`);
      return u.id;
    };

    if (driverId) {
      const prev = await db.driver.findUniqueOrThrow({ where: { id: driverId }, select: { status: true, userId: true } });
      const statusChanged = prev.status !== status;
      if (statusChanged && status !== "ACTIVE") await assertOffLoads(driverId, data.name);
      const userId = password && !prev.userId ? await createLogin() : undefined;
      await db.driver.update({ where: { id: driverId }, data: { ...data, ...(userId ? { userId } : {}) } });
      // The board only moves when employment actually changes: re-saving a driver on leave keeps a manual Rest.
      if (statusChanged) {
        if (status === "ACTIVE") await syncDriverBoardStatus(driverId, me.id, { force: true });
        else await parkOffDuty(driverId, status, me.id);
      }
      await audit(me.id, "update", "driver", driverId, data.name);
    } else {
      const userId = password ? await createLogin() : undefined;
      const d = await db.driver.create({ data: { ...data, userId } });
      id = d.id;
      if (status !== "ACTIVE") await parkOffDuty(d.id, status, me.id);
      await audit(me.id, "create", "driver", d.id, data.name);
    }
  });
  if (res?.error) return res;
  revalidatePath("/drivers");
  revalidatePath("/dispatch");
  redirect(`/drivers/${id}`);
}

/** Inline team change (drivers list / board). */
export async function setDriverTeam(driverId: string, teamId: string | null) {
  const me = await requireUser("drivers.edit");
  const d = await db.driver.update({ where: { id: driverId }, data: { teamId: teamId || null }, include: { team: true } });
  await audit(me.id, "team", "driver", driverId, `${d.name} → ${d.team?.name ?? "no team"}`);
  revalidatePath("/drivers");
  revalidatePath("/dispatch");
}

export async function setDriverHold(driverId: string, hold: boolean, reason?: string | null) {
  const me = await requireUser("drivers.edit");
  const d = await db.driver.update({ where: { id: driverId }, data: { hold, holdReason: hold ? reason ?? null : null } });
  await audit(me.id, hold ? "hold" : "release", "driver", driverId, `${d.name}${reason ? `: ${reason}` : ""}`);
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
  revalidatePath("/dispatch");
}

/** Employment status from the driver header. Refusals come back as { error } (a thrown message is hidden in production). */
export async function setDriverEmployment(driverId: string, status: string): Promise<ActionState> {
  const me = await requireUser("drivers.edit");
  const res = await attempt(async () => {
    if (!DRIVER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const prev = await db.driver.findUnique({ where: { id: driverId }, select: { name: true, status: true } });
    if (!prev) throw new FormError("This driver no longer exists.");
    if (prev.status === status) return { ok: "No change" };
    if (status !== "ACTIVE") await assertOffLoads(driverId, prev.name);
    await db.driver.update({ where: { id: driverId }, data: { status } });
    if (status === "ACTIVE") await syncDriverBoardStatus(driverId, me.id, { force: true });
    else await parkOffDuty(driverId, status, me.id);
    await audit(me.id, "status", "driver", driverId, `${prev.name} → ${status}`);
  });
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
  revalidatePath("/dispatch");
  return res;
}

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

export async function saveTeam(teamId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("users.manage");
  return attempt(async () => {
    const f = fields(fd);
    const data = { name: f.req("name", "Team name"), color: f.str("color"), sortOrder: f.num("sortOrder") ?? 0 };
    const t = teamId ? await db.team.update({ where: { id: teamId }, data }) : await db.team.create({ data });
    await audit(me.id, teamId ? "update" : "create", "team", t.id, t.name);
    revalidatePath("/admin/users");
    revalidatePath("/admin/company");
    revalidatePath("/dispatch");
    return { ok: `Team ${t.name} saved` };
  });
}

export async function deleteTeam(teamId: string) {
  const me = await requireUser("users.manage");
  const t = await db.team.delete({ where: { id: teamId } });
  await audit(me.id, "delete", "team", teamId, t.name);
  revalidatePath("/admin/users");
  revalidatePath("/admin/company");
  revalidatePath("/dispatch");
}

/* ------------------------------------------------------------------ */
/* Customers & brokers                                                 */
/* ------------------------------------------------------------------ */

export async function saveCustomer(customerId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("customers.edit");
  let id = customerId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const kind = f.str("kind") ?? "SHIPPER";
    if (!CUSTOMER_KINDS.includes(kind as never)) throw new FormError("Invalid kind");
    const data = {
      name: f.req("name", "Company name"),
      kind,
      contactName: f.str("contactName"),
      email: f.str("email"),
      phone: f.str("phone"),
      address: f.str("address"),
      city: f.str("city"),
      country: f.str("country"),
      taxId: f.str("taxId"),
      paymentTerms: f.num("paymentTerms") ?? 30,
      creditLimit: f.num("creditLimit") ?? 50000,
      notes: f.str("notes"),
    };
    if (customerId) await db.customer.update({ where: { id: customerId }, data });
    else id = (await db.customer.create({ data })).id;
    await audit(me.id, customerId ? "update" : "create", "customer", id, data.name);
  });
  if (res?.error) return res;
  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

/** Dispatch teams are made of dispatchers (and fleet managers); other roles don't carry a team. */
const teamFor = (role: string, teamId: string | null) => (role === "DISPATCHER" || role === "FLEET_MANAGER" ? teamId : null);

export async function createUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("users.manage");
  return attempt(async () => {
    const f = fields(fd);
    const role = f.req("role", "Role");
    if (!ROLES.includes(role as never)) throw new FormError("Invalid role");
    if (role === "OWNER" && me.role !== "OWNER") throw new FormError("Only the owner can create another owner");
    const password = f.req("password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    const user = await db.user.create({
      data: {
        name: f.req("name", "Name"),
        email: f.req("email", "Email").toLowerCase(),
        phone: f.str("phone"),
        role,
        teamId: teamFor(role, f.str("teamId")),
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    await audit(me.id, "create", "user", user.id, `${user.email} as ${role}`);
    revalidatePath("/admin/users");
    return { ok: `User ${user.email} created` };
  });
}

export async function updateUser(userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("users.manage");
  return attempt(async () => {
    const f = fields(fd);
    const target = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const role = f.req("role", "Role");
    const active = f.bool("active");
    if (!ROLES.includes(role as never)) throw new FormError("Invalid role");
    if ((target.role === "OWNER" || role === "OWNER") && me.role !== "OWNER") throw new FormError("Only the owner can change owner accounts");
    if (target.id === me.id && (!active || role !== me.role)) throw new FormError("You can't deactivate or demote yourself");
    const password = f.str("password");
    if (password && password.length < 8) throw new FormError("Password must be at least 8 characters");
    await db.user.update({
      where: { id: userId },
      data: { role, active, name: f.req("name", "Name"), phone: f.str("phone"), teamId: teamFor(role, f.str("teamId")), ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
    });
    await audit(me.id, "update", "user", userId,
      `${target.email}: role ${target.role}→${role}, active ${target.active}→${active}${password ? ", password reset" : ""}`);
    revalidatePath("/admin/users");
    return { ok: "User updated" };
  });
}
