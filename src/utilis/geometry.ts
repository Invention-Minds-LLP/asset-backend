// Geometry helpers for floor-plan zones. All coordinates are 0–100 percentages
// of the plan image, the same space AssetLocation.planX/planY uses.

export type Point = { x: number; y: number };
export type Polygon = [number, number][];

/** Normalises whatever shape came out of the JSON column into [[x,y], …]. */
export const asPolygon = (raw: any): Polygon => {
  if (!Array.isArray(raw)) return [];
  const out: Polygon = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2) {
      const x = Number(p[0]), y = Number(p[1]);
      if (isFinite(x) && isFinite(y)) out.push([x, y]);
    } else if (p && typeof p === "object" && "x" in p && "y" in p) {
      const x = Number((p as any).x), y = Number((p as any).y);
      if (isFinite(x) && isFinite(y)) out.push([x, y]);
    }
  }
  return out;
};

/**
 * Ray-casting point-in-polygon. Works for concave outlines, which matters —
 * traced rooms are rarely convex (L-shaped wards, corridors that wrap).
 */
export const pointInPolygon = (x: number, y: number, poly: Polygon): boolean => {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

/** Axis-aligned bounds — used to zoom the viewer to a zone. */
export const polygonBounds = (poly: Polygon) => {
  if (!poly.length) return null;
  let minX = poly[0][0], maxX = poly[0][0], minY = poly[0][1], maxY = poly[0][1];
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

/** Centroid of the polygon's area; falls back to the bounds centre for degenerate rings. */
export const polygonCentroid = (poly: Polygon): Point | null => {
  const b = polygonBounds(poly);
  if (!b) return null;
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const f = xj * yi - xi * yj;
    area += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  if (Math.abs(area) < 1e-9) return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  area *= 0.5;
  return { x: cx / (6 * area), y: cy / (6 * area) };
};
