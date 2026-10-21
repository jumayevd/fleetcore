import { useSyncExternalStore } from "react";
import { dayKeyOf } from "./shared";

/* Client hooks for the chat components (import from client components only). */

const noop = () => () => {};

/** False during SSR and hydration, true afterwards — gates markup that depends on the browser (localStorage, clock). */
export const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

/**
 * Today's company-calendar day for relative labels ("Today", "Yesterday", time vs date). SSR and the hydration render
 * use `serverToday` from the page so both produce the same text; after that the browser clock takes over.
 */
export function useToday(serverToday?: string) {
  const hydrated = useHydrated();
  return !hydrated && serverToday ? serverToday : dayKeyOf(new Date());
}
