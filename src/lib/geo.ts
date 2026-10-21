export type LatLng = { lat: number; lng: number };

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Road distance estimate: great-circle distance × typical road detour factor. */
export function roadKm(a: LatLng, b: LatLng) {
  return Math.round(haversineKm(a, b) * 1.25);
}

/** Road distance of a multi-stop route. */
export function routeKm(points: LatLng[]) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += roadKm(points[i - 1], points[i]);
  return km;
}

// Routes are drawn as a gentle quadratic curve so lines don't look like rulers.
function controlPoint(a: LatLng, b: LatLng): LatLng {
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  return { lat: mid.lat - dx * 0.12, lng: mid.lng + dy * 0.12 };
}

function pointOnRoute(a: LatLng, b: LatLng, t: number): LatLng {
  const c = controlPoint(a, b);
  const u = 1 - t;
  return {
    lat: u * u * a.lat + 2 * u * t * c.lat + t * t * b.lat,
    lng: u * u * a.lng + 2 * u * t * c.lng + t * t * b.lng,
  };
}

function routePolyline(a: LatLng, b: LatLng, steps = 32): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = pointOnRoute(a, b, i / steps);
    return [p.lat, p.lng];
  });
}

/** Polyline through every stop, curved per leg. */
export function pathPolyline(points: LatLng[], stepsPerLeg = 24): [number, number][] {
  if (points.length < 2) return points.map((p) => [p.lat, p.lng]);
  const out: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    const seg = routePolyline(points[i - 1], points[i], stepsPerLeg);
    out.push(...(i === 1 ? seg : seg.slice(1)));
  }
  return out;
}

/** Position at fraction t (0..1) of the total length of a polyline. */
export function pointAlongPolyline(poly: [number, number][], t: number): LatLng {
  if (poly.length === 0) return { lat: 0, lng: 0 };
  if (poly.length === 1 || t <= 0) return { lat: poly[0][0], lng: poly[0][1] };
  const legs: number[] = [];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const d = haversineKm({ lat: poly[i - 1][0], lng: poly[i - 1][1] }, { lat: poly[i][0], lng: poly[i][1] });
    legs.push(d);
    total += d;
  }
  if (t >= 1 || total === 0) return { lat: poly[poly.length - 1][0], lng: poly[poly.length - 1][1] };
  let target = t * total;
  for (let i = 0; i < legs.length; i++) {
    if (target <= legs[i]) {
      const f = legs[i] ? target / legs[i] : 0;
      const [aLat, aLng] = poly[i];
      const [bLat, bLng] = poly[i + 1];
      return { lat: aLat + (bLat - aLat) * f, lng: aLng + (bLng - aLng) * f };
    }
    target -= legs[i];
  }
  return { lat: poly[poly.length - 1][0], lng: poly[poly.length - 1][1] };
}

export function bearing(a: LatLng, b: LatLng) {
  const y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x =
    Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(((b.lng - a.lng) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
