export type ActionState = { error?: string; ok?: string } | undefined;

/** Read FormData fields with light coercion. */
export function fields(fd: FormData) {
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  return {
    str,
    req(k: string, label = k) {
      const v = str(k);
      if (v === null) throw new FormError(`${label} is required`);
      return v;
    },
    num(k: string) {
      const v = str(k);
      if (v === null) return null;
      const n = Number(v);
      if (Number.isNaN(n)) throw new FormError(`${k} must be a number`);
      return n;
    },
    date(k: string) {
      const v = str(k);
      if (v === null) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new FormError(`${k} must be a valid date`);
      return d;
    },
    bool: (k: string) => fd.get(k) === "on" || fd.get(k) === "true",
  };
}

export class FormError extends Error {}

/** Wrap a server action body: converts thrown FormErrors / Prisma unique errors into ActionState. */
export async function attempt(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: "Saved" };
  } catch (e) {
    if (e instanceof FormError) return { error: e.message };
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return { error: "A record with that unique value already exists." };
    }
    throw e; // includes Next redirect() signals
  }
}
