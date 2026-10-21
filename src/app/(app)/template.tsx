import type { ReactNode } from "react";

/**
 * Re-mounts on every navigation (unlike the layout), so each page and its loading skeleton fade up gently.
 * The animation lives in globals.css (.page-enter) and is switched off for reduced motion.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
