import type { MetadataRoute } from "next";

/** Name and icons when FleetCore is added to a phone's home screen or installed as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FleetCore",
    short_name: "FleetCore",
    description: "Trucks, trailers, maintenance and compliance for fleet specialists.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#801ab8",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
