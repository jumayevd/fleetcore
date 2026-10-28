import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, HOME, type Permission } from "./permissions";
import { getSessionContext, type ActiveContext } from "./session";
import type { Role } from "./constants";

/**
 * The person working in this request, as a member of the active company. `role` is their role in THIS company;
 * the same person may hold another role in another company.
 */
export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  lastLoginAt: Date | null;
  /** First and last name, ID number and date of birth are on file (src/lib/profile.ts). */
  profileComplete: boolean;
  role: Role;
  membershipId: string;
  /** units / timezone / currency: see src/lib/locale.ts (use getFormat() rather than reading them directly). */
  company: { id: string; name: string; color: string | null; units: string; timezone: string; currency: string };
};

const toUser = (a: ActiveContext): CurrentUser => ({ ...a.user, role: a.role, membershipId: a.membershipId, company: a.company });

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const { active } = await getSessionContext();
  return active ? toUser(active) : null;
});

/**
 * Use in pages and actions. Signed out → sign-in page; signed in but no company chosen (or access removed) → the
 * company chooser; lacking the permission → overview.
 */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const ctx = await getSessionContext();
  if (!ctx.accounts.length) redirect("/login");
  if (!ctx.active) redirect("/select");
  const user = toUser(ctx.active);
  if (permission && !can(user.role, permission)) redirect(HOME);
  return user;
}
