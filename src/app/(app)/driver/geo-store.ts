/**
 * Last GPS fix from the driver's phone, shared between the location card (writer) and the
 * stop / status forms (readers) so every status change can carry a position. Client only;
 * the fix is cleared when sharing stops, so readers never attach a stale point.
 */
export type Fix = { lat: number; lng: number; at: number };

let fix: Fix | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setFix(next: Fix) {
  fix = next;
  notify();
}
export function clearFix() {
  if (!fix) return;
  fix = null;
  notify();
}
export const getFix = () => fix;
export function subscribeFix(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
/** Position to attach to an action, or undefined when sharing is off or the fix is older than `maxAgeMs`. */
export function freshFix(maxAgeMs = 5 * 60_000): { lat: number; lng: number } | undefined {
  if (!fix || Date.now() - fix.at > maxAgeMs) return undefined;
  return { lat: fix.lat, lng: fix.lng };
}
