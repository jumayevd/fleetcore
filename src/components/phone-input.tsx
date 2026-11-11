"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui";
import { formatPhone } from "@/lib/phone";

/**
 * A phone field that tidies the number when you leave it ("3055550123" → "+1 (305) 555 0123"), with the same rule the
 * server saves with (src/lib/phone.ts), so what you see is what gets saved.
 */
export function PhoneInput({ onBlur, className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 (305) 555 0123" {...props} className={className ?? "num"}
      onBlur={(e) => { e.currentTarget.value = formatPhone(e.currentTarget.value) ?? ""; onBlur?.(e); }} />
  );
}
