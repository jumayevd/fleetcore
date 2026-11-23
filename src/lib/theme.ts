export type ThemePref = "light" | "dark" | "auto";
export const THEME_COOKIE = "theme";

/** Day is the default; Night and Auto (follow the device) are opt-in from the appearance menu. */
export const DEFAULT_THEME: ThemePref = "light";

export function parseThemePref(v: string | undefined | null): ThemePref {
  return v === "light" || v === "dark" || v === "auto" ? v : DEFAULT_THEME;
}


/* ------------------------------------------------------------------ */
/* Personal appearance (per browser, in cookies; applied before the   */
/* first paint by THEME_BOOT_SCRIPT: no flash)                         */
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

/**
 * Runs before first paint (inlined in <head>). Applies the saved theme ("auto" follows the OS; no cookie means Day) and
 * the saved accent, density and font. Doing this here rather than on the server keeps pages free of cookies, so the
 * public site is prebuilt and opens instantly. Keep it tiny and dependency-free.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,c=document.cookie,g=function(n,r){var m=c.match(new RegExp('(?:^|; )'+n+'=('+r+')(?:;|$)'));return m&&m[1];};var p=g('${THEME_COOKIE}','light|dark|auto')||'${DEFAULT_THEME}';d.setAttribute('data-theme',p==='auto'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p);var a=g('${APPEARANCE_COOKIE.accent}','${ACCENTS.join("|")}'),n=g('${APPEARANCE_COOKIE.density}','${DENSITIES.join("|")}'),f=g('${APPEARANCE_COOKIE.font}','${FONTS.join("|")}');if(a)d.setAttribute('data-accent',a);if(n)d.setAttribute('data-density',n);if(f)d.setAttribute('data-font',f);}catch(e){}})();`;
