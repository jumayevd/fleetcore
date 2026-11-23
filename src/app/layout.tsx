import type { Metadata, Viewport } from "next";
import { Alegreya_SC, Geist, Geist_Mono, Inter } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Alegreya SC (small caps) is the house face for every text, numbers included; Inter, Geist and the system font are
// personal options (Appearance). Alegreya SC isn't variable: 400 body, 500 medium, 700 for semibold and bold, 800 heavy.
const alegreya = Alegreya_SC({ variable: "--font-alegreya-sc", subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "500", "700", "800"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FleetCore", template: "%s · FleetCore" },
  description: "Trucks, trailers, maintenance and compliance for fleet specialists, across every company you work for.",
  // iPhone: Safari → Share → Add to Home Screen opens FleetCore full-screen under its own name and icon.
  appleWebApp: { capable: true, title: "FleetCore", statusBarStyle: "default" },
};

// Day is the default theme whatever the device prefers, so the browser chrome matches the Day canvas.
export const viewport: Viewport = { themeColor: "#f5f6f8" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // No cookies are read here, so pages without their own session work (the public site) are prebuilt and served
    // from the edge. Theme, accent, density and font are set from cookies by the boot script before first paint.
    // Font variables sit on <html> so the [data-font] switch in globals.css can resolve them at the root.
    <html
      lang="en"
      className={`${alegreya.variable} ${inter.variable} ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
