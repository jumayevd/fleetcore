"use client";

import { useEffect } from "react";

/** Brings the element with `id` into view once (a row someone linked to). */
export function ScrollTo({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [id]);
  return null;
}
