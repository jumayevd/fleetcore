import { LiveDot } from "@/components/ui";
import styles from "./signal.module.css";

// Illustrative lanes for the ornament — not data.
const LANES = [
  { unit: "TRK-104", from: "Tashkent", to: "Samarkand", eta: "14:20", dur: "17s", delay: "-6s", rest: "62%" },
  { unit: "TRK-118", from: "Bukhara", to: "Navoi", eta: "16:05", dur: "23s", delay: "-14s", rest: "38%" },
  { unit: "TRK-131", from: "Andijan", to: "Tashkent", eta: "19:40", dur: "29s", delay: "-3s", rest: "18%" },
];

/** Dotted grid behind the left panel. Fades out towards the edges. */
export function SignalGrid() {
  return <div aria-hidden className={styles.grid} />;
}

/** A quiet live board: three lanes with amber runners travelling pickup → delivery. */
export function Signal() {
  return (
    <div aria-hidden className={styles.board}>
      <div className={styles.head}>
        <LiveDot label="Live board" />
        <span>3 units en route · updated just now</span>
      </div>
      <div className={styles.lanes}>
        {LANES.map((l) => (
          <div key={l.unit} className={styles.lane}>
            <span className={styles.unit}>{l.unit}</span>
            <span className={styles.track} style={{ "--dur": l.dur, "--delay": l.delay, "--rest": l.rest } as React.CSSProperties}>
              <span className={styles.runner}><span className={styles.dot} /></span>
            </span>
            <span className={styles.eta}>ETA {l.eta}</span>
          </div>
        ))}
      </div>
      <div className={styles.foot}>
        <span>On time <b>96%</b></span>
        <span>Ready to invoice <b>12</b></span>
        <span>Docs missing <b>3</b></span>
      </div>
    </div>
  );
}
