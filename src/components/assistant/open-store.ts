// Whether the assistant panel is open, kept in sessionStorage (survives navigation within the tab) and exposed as
// a tiny external store. Separate from the chat module so the always-mounted launcher stays free of the AI SDK.
const ASSISTANT_OPEN_KEY = "fleetops.assistant.open";
const listeners = new Set<() => void>();

export const readOpen = () => { try { return sessionStorage.getItem(ASSISTANT_OPEN_KEY) === "1"; } catch { return false; } };
export const writeOpen = (v: boolean) => {
  try { sessionStorage.setItem(ASSISTANT_OPEN_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
};
export const subscribeOpen = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
