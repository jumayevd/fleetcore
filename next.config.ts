import type { NextConfig } from "next";

/**
 * Browser-side hardening on every response: no framing by other sites (clickjacking), no MIME sniffing, no full
 * URLs (invite and password links carry tokens) sent to other sites, no plugins, and no camera, microphone or location
 * APIs. HTTPS-only (HSTS) comes from Vercel. No script CSP yet: Next.js inline scripts would need nonces.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Dev only: the badge's default corner (bottom-left) covers the sidebar's collapse button.
  devIndicators: { position: "top-right" },
  experimental: {
    // Pages stay in the browser for a short while, so going back to one just opened shows it at once instead of
    // waiting on the server (a round trip from Central Asia to fra1 is ~0.4 s). Saving anything refreshes them.
    // static: also how long a sidebar page loaded on hover (prefetch={true}) is kept.
    staleTimes: { dynamic: 30, static: 60 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
