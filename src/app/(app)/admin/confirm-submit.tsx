"use client";

import type { ComponentProps } from "react";

/**
 * Submit button that asks first, for plain `<form action={serverAction}>` forms whose action returns nothing
 * and so can't go through ActionForm's `confirm`. Cancelling the dialog leaves the form unsent.
 */
export function ConfirmSubmit({ confirm, ...props }: Omit<ComponentProps<"button">, "type" | "onClick"> & { confirm: string }) {
  return <button {...props} type="submit" onClick={(e) => { if (!window.confirm(confirm)) e.preventDefault(); }} />;
}
