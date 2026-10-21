"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";
import type * as Charts from "./charts";

/**
 * The Recharts charts, loaded after the page has painted. Recharts is ~120 KB gzipped; pages render without it
 * and the chart fades in behind a placeholder of the same height, so nothing jumps. Nothing is lost by not
 * rendering them on the server: they measure their container in the browser anyway.
 * Plain HTML/SVG pieces (Spark, Bars, ChartEmpty) come from charts-lite and need no loading at all.
 */
function lazyChart<P extends { height?: number }>(load: () => Promise<ComponentType<P>>, defaultHeight: number) {
  const Chart = dynamic(load, { ssr: false, loading: () => <div aria-hidden className="skeleton absolute inset-0 opacity-60" /> });
  function LazyChart(props: P) {
    return (
      <div className="relative" style={{ minHeight: props.height ?? defaultHeight }}>
        <Chart {...props} />
      </div>
    );
  }
  return LazyChart;
}

export const RevenueChart = lazyChart<ComponentProps<typeof Charts.RevenueChart>>(() => import("./charts").then((m) => m.RevenueChart), 260);
export const SimpleBar = lazyChart<ComponentProps<typeof Charts.SimpleBar>>(() => import("./charts").then((m) => m.SimpleBar), 260);
export const TrendLine = lazyChart<ComponentProps<typeof Charts.TrendLine>>(() => import("./charts").then((m) => m.TrendLine), 240);
export const Donut = lazyChart<ComponentProps<typeof Charts.Donut>>(() => import("./charts").then((m) => m.Donut), 220);
