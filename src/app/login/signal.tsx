import { LiveDot } from "@/components/ui";
import styles from "./signal.module.css";

// Illustrative units for the ornament — not data.
const LANES = [
  { unit: "T-104", note: "PM in 1,800 km", dur: "17s", delay: "-6s", rest: "62%" },
  { unit: "C-07", note: "Insurance 9d", dur: "23s", delay: "-14s", rest: "38%" },
  { unit: "N-512", note: "In shop 2d", dur: "29s", delay: "-3s", rest: "18%" },
];

/** Dotted grid behind the left panel. Fades out towards the edges. */
export function SignalGrid() {
  return <div aria-hidden className={styles.grid} />;
}

/** A quiet live board: three units from three companies, with the one thing each needs next. */
export function Signal() {
  return (
    <div aria-hidden className={styles.board}>
      <div className={styles.head}>
        <LiveDot label="Live fleet" />
        <span>3 companies · updated just now</span>
      </div>
      <div className={styles.lanes}>
        {LANES.map((l) => (
          <div key={l.unit} className={styles.lane}>
            <span className={styles.unit}>{l.unit}</span>
            <span className={styles.track} style={{ "--dur": l.dur, "--delay": l.delay, "--rest": l.rest } as React.CSSProperties}>
              <span className={styles.runner}><span className={styles.dot} /></span>
            </span>
            <span className={styles.eta}>{l.note}</span>
          </div>
        ))}
      </div>
      <div className={styles.foot}>
        <span>PM due <b>3</b></span>
        <span>Papers expiring <b>4</b></span>
        <span>In shop <b>2</b></span>
      </div>
    </div>
  );
}
