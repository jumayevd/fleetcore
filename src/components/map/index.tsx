"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

// Leaflet touches `window`, so it can only render on the client.
const LeafletMapInner = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-lg bg-sunken" />,
});

/**
 * The wrapper owns the height, so the loading placeholder and the loaded map take exactly the
 * same space (no jump when Leaflet arrives). `height` accepts px or any CSS length ("100%").
 */
export function LeafletMap(props: ComponentProps<typeof LeafletMapInner>) {
  return (
    <div style={{ height: props.height ?? 520 }}>
      <LeafletMapInner {...props} height="100%" />
    </div>
  );
}

export type { MapTruck, MapPoint, MapPointKind } from "./leaflet-map";
