"use client";

import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { bigButton } from "../parts";

/** The first visit of the day may have to build the demo fleet: say so instead of looking stuck. */
export function DemoButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={bigButton()}>
      {pending ? <><Loader2 className="animate-spin" />Opening the demo fleet…</> : <>Open the live demo<ArrowRight /></>}
    </button>
  );
}
