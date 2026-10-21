import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSessionContext } from "./session";

/**
 * Which company a piece of server work belongs to. Normally the active company of the signed-in request; jobs that
 * run without a browser session (seeding, cross-company summaries) pin one explicitly with `withCompany`.
 */
const pinned = new AsyncLocalStorage<string>();

export function withCompany<T>(companyId: string, fn: () => T): T {
  return pinned.run(companyId, fn);
}

export class NoCompanyError extends Error {
  constructor() {
    super("No company is active for this request. Sign in and choose a company first.");
  }
}

export async function currentCompanyId(): Promise<string> {
  const id = pinned.getStore();
  if (id) return id;
  const { active } = await getSessionContext();
  if (!active) throw new NoCompanyError();
  return active.company.id;
}
