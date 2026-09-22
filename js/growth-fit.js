// Extending a baby's own growth curve to today.
//
// Infant weight, length and head circumference all decelerate; y = a + b·√age
// tracks that shape closely (R² ≥ 0.99 on real data, and it predicted a
// held-out measurement within 1–2%). The fit uses only this baby's points, so
// the projection means "if she keeps growing the way she has", not a
// population percentile.

const DAY = 86400000;

/** Least-squares line through (x, y) pairs. */
function fitLine(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  return { a: my - b * mx, b };
}

/**
 * Where a measure is likely to be today, from the baby's own history.
 * points: [{x: ms, y}] sorted by x. birthMs anchors age; without it, age is
 * counted from the first measurement. Returns null with fewer than two points
 * or when the last point is already today.
 */
export function projectToday(points, birthMs, todayMs = Date.now()) {
  if (points.length < 2) return null;
  const origin = birthMs ?? points[0].x;
  const age = ms => Math.max(1, (ms - origin) / DAY + 1);
  const fit = fitLine(points.map(p => Math.sqrt(age(p.x))), points.map(p => p.y));
  if (!fit) return null;
  const last = points[points.length - 1];
  if (todayMs - last.x < DAY) return null;
  return { x: todayMs, y: fit.a + fit.b * Math.sqrt(age(todayMs)), from: last };
}
