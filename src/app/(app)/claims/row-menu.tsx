"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, MoreHorizontal, Pencil } from "lucide-react";
import { DropMenu, type MenuItem } from "./menu";

/** Row actions for a claim: open, edit (claims.edit) and copy the claim number. */
export function ClaimRowMenu({ id, number, canEdit }: { id: string; number: string; canEdit: boolean }) {
  const [copied, setCopied] = useState(false);
  const items: MenuItem[] = [
    { label: "Open", icon: <ExternalLink />, href: `/claims/${id}` },
    ...(canEdit ? [{ label: "Edit", icon: <Pencil />, href: `/claims/${id}/edit` }] : []),
    {
      label: copied ? "Copied" : "Copy number", icon: copied ? <Check /> : <Copy />,
      onSelect: () => {
        navigator.clipboard?.writeText(number).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => undefined);
      },
    },
  ];
  return (
    <DropMenu items={items} label={`Actions for ${number}`} width={200}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-sunken hover:text-fg aria-expanded:bg-sunken aria-expanded:text-fg">
      <MoreHorizontal className="h-4 w-4" />
    </DropMenu>
  );
}
