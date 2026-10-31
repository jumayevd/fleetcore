"use client";

import { Ellipsis, Eye, Pencil, Truck, FileText, Trash2 } from "lucide-react";
import { DropMenu, type MenuItem } from "../menu";

const triggerClass = "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-raised hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&_svg]:h-4 [&_svg]:w-4";

export function TrailerRowMenu({ id, truckId, editable, canDelete }: { id: string; truckId: string | null; editable: boolean; canDelete?: boolean }) {
  const items: MenuItem[] = [
    { label: "Open trailer", href: `/fleet/trailers/${id}`, icon: <Eye /> },
    { label: "Documents", href: `/fleet/trailers/${id}#documents`, icon: <FileText /> },
  ];
  if (editable) items.push({ label: "Edit", href: `/fleet/trailers/${id}/edit`, icon: <Pencil /> });
  if (truckId) items.push({ label: "Open paired truck", href: `/fleet/${truckId}`, icon: <Truck /> });
  // Deleting asks for the unit number on the edit page.
  if (canDelete) items.push({ label: "Delete trailer", href: `/fleet/trailers/${id}/edit#delete`, icon: <Trash2 />, danger: true });
  return <DropMenu items={items} label="Trailer actions" className={triggerClass} width={200}><Ellipsis /></DropMenu>;
}
