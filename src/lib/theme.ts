export type ThemePref = "light" | "dark" | "auto";
export const THEME_COOKIE = "theme";

/** Day is the default; Night and Auto (follow the device) are opt-in from the appearance menu. */
export const DEFAULT_THEME: ThemePref = "light";

export function parseThemePref(v: string | undefined | null): ThemePref {
  return v === "light" || v === "dark" || v === "auto" ? v : DEFAULT_THEME;
}

/**
 * Runs before first paint (inlined in <head>). Applies the saved choice; "auto" follows the OS; no cookie
 * means Day. Keeps the page from flashing the wrong theme. Keep it tiny and dependency-free.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|auto)/);var p=m?m[1]:'${DEFAULT_THEME}';var t=p==='auto'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

/* ------------------------------------------------------------------ */
/* Personal appearance (per browser, in cookies so the server renders */
/* the first paint with them: no flash)                                */
/* ------------------------------------------------------------------ */

export const ACCENTS = ["blue", "indigo", "violet", "teal", "green", "amber", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
/** Swatch colours for the picker only; the real palettes live in globals.css ([data-accent]). */
export const ACCENT_SWATCH: Record<Accent, string> = {
  blue: "#2563eb", indigo: "#4f46e5", violet: "#7c3aed", teal: "#0d9488", green: "#16a34a", amber: "#f59e0b", graphite: "#344054",
};

export const DENSITIES = ["compact", "default", "comfortable"] as const;
export type Density = (typeof DENSITIES)[number];

/** Alegreya SC is the house face; the others are personal options. */
export const FONTS = ["alegreya", "inter", "geist", "system"] as const;
export type FontChoice = (typeof FONTS)[number];
export const FONT_LABEL: Record<FontChoice, string> = { alegreya: "Alegreya SC", inter: "Inter", geist: "Geist", system: "System" };

export const APPEARANCE_COOKIE = { accent: "accent", density: "density", font: "font" } as const;

const oneOf = <T extends string>(list: readonly T[], v: string | undefined | null, fallback: T): T =>
  (list as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
export const parseAccent = (v?: string | null) => oneOf(ACCENTS, v, "blue");
export const parseDensity = (v?: string | null) => oneOf(DENSITIES, v, "default");
export const parseFont = (v?: string | null) => oneOf(FONTS, v, "alegreya");

/** Write one appearance cookie for a year and apply it to <html> right away. */
export function saveAppearance(name: "accent" | "density" | "font", value: string) {
  document.cookie = `${APPEARANCE_COOKIE[name]}=${value}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.setAttribute(`data-${name}`, value);
}
