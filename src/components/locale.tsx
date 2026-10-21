"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, makeFormat, type CompanyLocale } from "@/lib/locale";

const LocaleContext = createContext<CompanyLocale>(DEFAULT_LOCALE);

/** Mounted by the app shell with the active company's locale. */
export function LocaleProvider({ locale, children }: { locale: CompanyLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Formatter in the active company's units and time zone, for client components. */
export function useFormat() {
  const locale = useContext(LocaleContext);
  return useMemo(() => makeFormat(locale), [locale]);
}

export const useLocale = () => useContext(LocaleContext);
