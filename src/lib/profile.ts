import { FormError } from "@/lib/action";
import type { fields } from "@/lib/action";

/*
 * Personal details of an account: first and last name, ID number (passport, national ID or employee number) and date
 * of birth. Everyone who joins a company by invitation gives them (sign-up form, or the one-time /profile page for
 * an account that existed already); they are the same in every company. Owners and admins see them under Members.
 */

export type ProfileFields = { firstName: string | null; lastName: string | null; idNumber: string | null; birthDate: Date | null };

export const isProfileComplete = (u: ProfileFields) => Boolean(u.firstName && u.lastName && u.idNumber && u.birthDate);

/** First and last name for a form: the stored ones, else split from the display name. */
export function nameParts(u: { name: string; firstName: string | null; lastName: string | null }) {
  if (u.firstName || u.lastName) return { first: u.firstName ?? "", last: u.lastName ?? "" };
  const [first = "", ...rest] = u.name.trim().split(/\s+/);
  return { first, last: rest.join(" ") };
}

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;
const ID = /^[\p{L}\p{N}][\p{L}\p{N} ./-]*$/u;
const MIN_AGE = 16, MAX_AGE = 100;

/** "1990-03-12" → that day at 00:00 UTC (a date column), or a FormError. */
export function parseBirthDate(raw: string, now = new Date()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new FormError("Enter the date of birth as day, month and year.");
  const age = (now.getTime() - d.getTime()) / (365.2425 * 86_400_000);
  if (age < MIN_AGE || age > MAX_AGE) throw new FormError(`Check the date of birth: that would make you ${Math.floor(age)}.`);
  return d;
}

/**
 * The details from a form. `required`: all four must be there (invited members); otherwise only the names are, and
 * an empty ID number or date of birth is saved as empty.
 */
export function readProfile(f: ReturnType<typeof fields>, required: boolean) {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const firstName = clean(f.req("firstName", "First name"));
  const lastName = clean(f.req("lastName", "Last name"));
  if (!NAME.test(firstName) || firstName.length > 60) throw new FormError("Check the first name: letters, spaces, hyphens and apostrophes only.");
  if (!NAME.test(lastName) || lastName.length > 60) throw new FormError("Check the last name: letters, spaces, hyphens and apostrophes only.");
  const idRaw = clean(required ? f.req("idNumber", "ID number") : f.str("idNumber"));
  if (idRaw && (!ID.test(idRaw) || idRaw.length < 3 || idRaw.length > 40)) throw new FormError("Check the ID number: 3 to 40 letters and digits.");
  const dobRaw = required ? f.req("birthDate", "Date of birth") : f.str("birthDate");
  return {
    firstName, lastName, name: `${firstName} ${lastName}`,
    idNumber: idRaw ? idRaw.toUpperCase() : null,
    birthDate: dobRaw ? parseBirthDate(dobRaw) : null,
  };
}

/** A stored date of birth for an <input type="date">. */
export const birthDateValue = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** "12 Mar 1990 · 36": read in UTC, since a date of birth has no time zone (the company's would shift it a day). */
export function birthDateLabel(d: Date, now = new Date()) {
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return `${day} · ${age}`;
}
