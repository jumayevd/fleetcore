"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { inputClass, cn } from "@/components/ui";
import { sendContact } from "@/app/actions/site";
import { PLANS } from "@/lib/site";
import { bigButton } from "../parts";
import { useAsked } from "./from-link";

const label = "mb-1.5 block text-[13px] font-medium text-fg";
const field = cn(inputClass, "h-10 text-[14px]");

export function ContactForm() {
  const plan = useAsked().plan?.id;
  const [state, action, pending] = useActionState(sendContact, undefined);

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col items-start justify-center rounded-2xl border border-line bg-surface p-8">
        <CheckCircle2 className="h-9 w-9 text-ok" />
        <h2 className="mt-4 text-[22px] font-semibold">Thanks, we&apos;ve got it.</h2>
        <p className="mt-2 text-[15px] leading-7 text-fg-muted">We&apos;ll get back to you within one business day.</p>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="c-name" className={label}>Your name *</label><input id="c-name" name="name" required autoComplete="name" maxLength={120} className={field} /></div>
        <div><label htmlFor="c-company" className={label}>Company</label><input id="c-company" name="company" autoComplete="organization" maxLength={160} className={field} /></div>
        <div><label htmlFor="c-email" className={label}>Email *</label><input id="c-email" name="email" type="email" required autoComplete="email" maxLength={200} className={field} /></div>
        <div><label htmlFor="c-phone" className={label}>Phone</label><input id="c-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} className={field} /></div>
        <div>
          <label htmlFor="c-size" className={label}>Trucks in your fleet</label>
          <select id="c-size" name="fleetSize" defaultValue="" className={field}>
            <option value="">Choose…</option>
            {["1–10", "11–25", "26–50", "51–150", "150+"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="c-plan" className={label}>Plan</label>
          <select key={plan ?? ""} id="c-plan" name="plan" defaultValue={plan ?? ""} className={field}>
            <option value="">Not sure yet</option>
            {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="c-message" className={label}>Message</label>
          <textarea id="c-message" name="message" rows={5} maxLength={4000} placeholder="What would you like FleetCore to sort out for you?" className={cn(inputClass, "h-auto py-2 text-[14px]")} />
        </div>
        {/* Only bots fill this in. */}
        <div aria-hidden className="absolute -left-[9999px]"><label htmlFor="c-website">Website</label><input id="c-website" name="website" tabIndex={-1} autoComplete="off" /></div>
      </div>
      {state?.error && <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className={cn(bigButton(), "mt-6 w-full")}>
        {pending ? <><Loader2 className="animate-spin" />Sending…</> : <>Send message<Send /></>}
      </button>
      <p className="mt-3 text-center text-[12px] text-fg-subtle">We only use your details to answer you.</p>
    </form>
  );
}
