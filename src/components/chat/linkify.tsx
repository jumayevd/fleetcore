import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * Renders a message body with URLs and load references turned into links.
 * `LD-10102` → /loads?q=LD-10102 (plain text for viewers without loads.view, e.g. drivers).
 * Line breaks are preserved by the caller via `whitespace-pre-wrap`.
 */
export function Linkified({ text, loadLinks = true }: { text: string; loadLinks?: boolean }) {
  const re = /(https?:\/\/[^\s<]+)|(\bLD-\d+\b)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      let url = m[1];
      let trail = "";
      const t = /[.,;:!?)\]'"]+$/.exec(url);
      if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
      out.push(
        <a key={i++} href={url} target="_blank" rel="noreferrer noopener" className="break-all text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
          {url.replace(/^https?:\/\//, "")}
        </a>,
      );
      if (trail) out.push(<Fragment key={i++}>{trail}</Fragment>);
    } else if (m[2]) {
      out.push(
        loadLinks
          ? <Link key={i++} href={`/loads?q=${encodeURIComponent(m[2])}`} className="num font-medium text-accent-text hover:underline">{m[2]}</Link>
          : <span key={i++} className="num font-medium text-fg">{m[2]}</span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
