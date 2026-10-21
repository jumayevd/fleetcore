import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { cookies } from "next/headers";
import { APPEARANCE_COOKIE, THEME_BOOT_SCRIPT, THEME_COOKIE, parseAccent, parseDensity, parseFont, parseThemePref } from "@/lib/theme";
import "./globals.css";

// Inter is the default UI face (crisp at small sizes on Windows); Geist and the system font are personal options.
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FleetOps", template: "%s · FleetOps" },
  description: "Trucks, trailers, maintenance and compliance for fleet specialists, across every company you work for.",
};

// Day is the default theme whatever the device prefers, so the browser chrome matches the Day canvas.
export const viewport: Viewport = { themeColor: "#f5f6f8" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies();
  const pref = parseThemePref(jar.get(THEME_COOKIE)?.value);
  return (
    // "auto" is resolved by the boot script before first paint, so the attribute may be set client-side.
    // Font variables sit on <html> so the [data-font] switch in globals.css can resolve them at the root.
    <html
      lang="en"
      data-theme={pref === "auto" ? undefined : pref}
      data-accent={parseAccent(jar.get(APPEARANCE_COOKIE.accent)?.value)}
      data-density={parseDensity(jar.get(APPEARANCE_COOKIE.density)?.value)}
      data-font={parseFont(jar.get(APPEARANCE_COOKIE.font)?.value)}
      className={`${inter.variable} ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
