/** The account every live-demo visitor works as (src/lib/demo). */
export const DEMO_EMAIL = "demo@fleetcore.invalid";
/** Owns the demo company; nobody signs in as it. */
export const DEMO_OWNER_EMAIL = "demo-owner@fleetcore.invalid";

/** The shared demo account: no password or profile changes, no mailbox, no assistant. */
export const isDemoEmail = (email: string | null | undefined) => email === DEMO_EMAIL;

export const DEMO_BLOCKED = "That isn't available in the live demo.";
