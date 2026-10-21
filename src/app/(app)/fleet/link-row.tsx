"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, KeyboardEvent, MouseEvent } from "react";
import { cn } from "@/components/ui";

const INTERACTIVE = "a,button,input,select,textarea,label,[role=menu],[data-no-row-link]";

/** Table row that opens `href` on click (links, buttons and menus inside the row still work on their own). */
export function LinkRow({ href, className, children, ...rest }: ComponentProps<"tr"> & { href: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return; // the user is selecting text, not navigating
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget) router.push(href);
  };
  return (
    <tr {...rest} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} onMouseEnter={() => router.prefetch(href)}
      className={cn("cursor-pointer focus:outline-none focus-visible:bg-raised", className)}>
      {children}
    </tr>
  );
}
