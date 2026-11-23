"use client";

import { useSyncExternalStore } from "react";
import { CONTACT_PLANS } from "@/lib/site";

/*
 * The contact page is prebuilt, so what the link asked for (?plan=… from Pricing, ?topic=demo) is read in the browser:
 * the prebuilt HTML is the plain version, and the right wording and plan appear as soon as the page hydrates.
 */

const noSubscribe = () => () => {};

/** The plan and topic the link asked for; nothing on the server (prebuilt HTML). */
export function useAsked() {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const sp = new URLSearchParams(search);
  return { plan: CONTACT_PLANS.find((p) => p.id === sp.get("plan")), demo: sp.get("topic") === "demo" };
}

/** The heading and intro, worded for what the visitor came for. */
export function ContactIntro() {
  const { plan, demo } = useAsked();
  const intro = plan
    ? `You picked ${plan.name}. Tell us a little about your fleet and we'll get you set up.`
    : demo ? "Tell us when suits you and we'll show you FleetCore on your own kind of fleet."
    : "Pricing, a walkthrough, moving your data in, or just a question: write to us.";
  return (
    <>
      <h1 className="mt-4 text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
        {demo ? "Book a walkthrough." : "Let's get your fleet on FleetCore."}
      </h1>
      <p className="mt-5 text-[17px] leading-8 text-fg-muted">{intro}</p>
    </>
  );
}
