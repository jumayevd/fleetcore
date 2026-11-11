/*
 * Phone numbers, saved one way: a US / North American number always reads "+1 (305) 555 0123", however it was typed
 * ("3055550123", "(305) 555-0123", "1-305-555-0123", "+1 305 555 0123"). A number with another country code
 * ("+998 90 123 45 67") or that isn't 10 digits is kept as typed, only with its spaces tidied, since forcing it into the
 * US shape would make it wrong. Client-safe: forms format on blur with the same rule the server saves with.
 * The same rule in SQL reformatted the numbers saved before (migration 17_phone_format).
 */

export function formatPhone(input: string | null | undefined): string | null {
  const typed = (input ?? "").trim().replace(/\s+/g, " ");
  if (!typed) return null;
  const digits = typed.replace(/\D/g, "");
  const us = typed.startsWith("+")
    ? (digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null)
    : digits.length === 10 ? digits : digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
  // Letters (an extension, "ext 12", a note) mean it isn't just a number: keep it as typed.
  if (!us || /[a-z]/i.test(typed)) return typed;
  return `+1 (${us.slice(0, 3)}) ${us.slice(3, 6)} ${us.slice(6)}`;
}
