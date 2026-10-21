import "server-only";
import { cache } from "react";
import { getCurrentUser } from "./auth";
import { makeFormat, normalizeLocale, type CompanyLocale } from "./locale";

/** The active company's units, time zone and currency (defaults when nobody is signed in). */
export const getLocale = cache(async (): Promise<CompanyLocale> => normalizeLocale((await getCurrentUser())?.company));

/** Formatter in the active company's units and time zone. In server components: `const f = await getFormat()`. */
export const getFormat = cache(async () => makeFormat(await getLocale()));
