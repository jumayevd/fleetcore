import { cn } from "./ui";
import { ICON, WORDMARK } from "./brand-art";

/*
 * The FleetCore brand: the "fleetcore" wordmark (the "o" is a wheel with a purple nut) and the wheel app icon.
 * Letters and ring take the text colour, so the wordmark follows Day and Night; the purple is the --mark token.
 * The same art as files: public/brand/*.svg, src/app/icon.svg, src/app/favicon.ico, src/app/apple-icon.png.
 */

/** "fleetcore". Size it by height (h-6 is the default); the width follows. */
export function Wordmark({ className, title = "FleetCore" }: { className?: string; title?: string }) {
  const { width, height, letters, ring, nut } = WORDMARK;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className={cn("h-6 w-auto shrink-0 text-fg", className)}>
      <path fill="currentColor" fillRule="evenodd" d={letters} />
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} fill="none" stroke="currentColor" strokeWidth={ring.width} />
      <polygon points={nut.points} fill="var(--mark)" stroke="var(--mark)" strokeWidth={nut.stroke} strokeLinejoin="round" />
    </svg>
  );
}

/** The wheel app icon: purple rounded square, white ring and nut. Decorative unless given a title. */
export function BrandIcon({ className, title }: { className?: string; title?: string }) {
  const { size, corner, ring, nut } = ICON;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      className={cn("h-5 w-5 shrink-0", className)}>
      <rect width={size} height={size} rx={corner} fill="var(--mark)" />
      <circle cx={size / 2} cy={size / 2} r={ring.r} fill="none" stroke="var(--on-mark)" strokeWidth={ring.width} />
      <polygon points={nut.points} fill="var(--on-mark)" stroke="var(--on-mark)" strokeWidth={nut.stroke} strokeLinejoin="round" />
    </svg>
  );
}
