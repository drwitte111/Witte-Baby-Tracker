/**
 * Photo framing, the way the Big Year app does it: the photo sits inside a
 * square circle at "cover" size, a zoom scales it up from there, and a pan is
 * a plain percentage offset from centred. Everything is a percentage of the
 * circle, so the 160px framing preview and the 34px list avatar show exactly
 * the same crop.
 *
 *   frame = { ox, oy, zoom, aspect }   ox/oy in % of the circle, aspect = w/h
 */
import { esc } from './ui.js';

export const DEFAULT_ZOOM = 1.2;

export function saneFrame(f, aspect) {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const a = n(f?.aspect, aspect) || aspect || 0;
  return {
    ox: Math.max(-400, Math.min(400, n(f?.ox, 0))),
    oy: Math.max(-400, Math.min(400, n(f?.oy, 0))),
    zoom: Math.max(0.2, Math.min(4, n(f?.zoom, DEFAULT_ZOOM))),
    aspect: a > 0.05 && a < 20 ? a : 0,
  };
}

/** Photo size as % of the circle: "cover" (zoom 1) puts the shorter side at 100%. */
export function photoSize(aspect, zoom) {
  return aspect >= 1
    ? { w: 100 * zoom * aspect, h: 100 * zoom }
    : { w: 100 * zoom, h: 100 * zoom / aspect };
}

/** Inline style that places the photo inside its circle. */
export function frameStyle(frame) {
  const f = saneFrame(frame);
  if (!f.aspect) return 'width:100%;height:100%;object-fit:cover;';     // square photo saved before framing existed
  const { w, h } = photoSize(f.aspect, f.zoom);
  const r = n => Math.round(n * 100) / 100;
  return `position:absolute;width:${r(w)}%;height:${r(h)}%;left:${r((100 - w) / 2 + f.ox)}%;top:${r((100 - h) / 2 + f.oy)}%;max-width:none;`;
}

/** The photo may be dragged until its own centre reaches the circle's edge. */
export function panLimit(frame) {
  const f = saneFrame(frame);
  if (!f.aspect) return { x: 0, y: 0 };
  const { w, h } = photoSize(f.aspect, f.zoom);
  return { x: w / 2, y: h / 2 };
}

/** Zoom at which the photo's longer side exactly fits the circle. */
export function containZoom(aspect) { return aspect ? Math.min(aspect, 1 / aspect) : 1; }

/** What goes inside an avatar circle: the framed photo, or the initial. */
export function avatarInner(baby) {
  if (!baby?.photo) return esc((baby?.name || '•').trim()[0].toUpperCase());
  return `<img src="${baby.photo}" alt="" draggable="false" style="${frameStyle(baby.frame)}">`;
}

/** Avatar markup for a baby: framed photo, or the initial. */
export function avatarHtml(baby, cls = '') {
  return `<span class="avatar ${cls}">${avatarInner(baby)}</span>`;
}

/**
 * Wire drag-to-pan and a zoom slider onto a preview circle. `frame` is mutated
 * in place; `onChange` repaints. Returns a small controller.
 */
export function bindFraming(circle, slider, frame, onChange) {
  let startX = 0, startY = 0, ox0 = 0, oy0 = 0, dragging = false;
  const size = () => circle.getBoundingClientRect().width || 160;
  const clamp = (v, max) => Math.max(-max, Math.min(max, v));

  circle.addEventListener('pointerdown', e => {
    dragging = true; startX = e.clientX; startY = e.clientY; ox0 = frame.ox; oy0 = frame.oy;
    circle.setPointerCapture(e.pointerId); e.preventDefault();
  });
  circle.addEventListener('pointermove', e => {
    if (!dragging) return;
    // The photo moves exactly as far as the finger does, at every zoom.
    const lim = panLimit(frame), s = size();
    frame.ox = clamp(ox0 + (e.clientX - startX) / s * 100, lim.x);
    frame.oy = clamp(oy0 + (e.clientY - startY) / s * 100, lim.y);
    onChange();
  });
  const end = e => { if (!dragging) return; dragging = false; try { circle.releasePointerCapture(e.pointerId); } catch {} };
  circle.addEventListener('pointerup', end);
  circle.addEventListener('pointercancel', end);

  slider.addEventListener('input', () => { frame.zoom = Math.max(0.2, Math.min(4, Number(slider.value) || 1)); onChange(); });

  return {
    reset() { frame.ox = 0; frame.oy = 0; frame.zoom = DEFAULT_ZOOM; slider.value = String(frame.zoom); onChange(); },
    fit()   { frame.ox = 0; frame.oy = 0; frame.zoom = containZoom(frame.aspect); slider.value = String(frame.zoom); onChange(); },
  };
}
