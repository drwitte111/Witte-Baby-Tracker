// Hand-rolled inline SVG charts: no dependencies, one hover layer, theme-aware
// via CSS custom properties. Every builder takes an explicit pixel width so
// text renders 1:1 instead of being scaled by a viewBox.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A step a person would choose: 1, 2, 2.5, 5, 10 x a power of ten.
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

// Axis from zero that lands on round numbers.
function niceScale(maxValue, count = 3) {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
  const step = niceStep(maxValue / count);
  return { max: step * count, ticks: Array.from({ length: count + 1 }, (_, i) => +(i * step).toFixed(6)) };
}

// Axis for a band of values that need not include zero (growth curves).
function niceBand(lo, hi, count = 3) {
  if (hi === lo) { const pad = Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
  const step = niceStep((hi - lo) / count);
  const base = Math.floor(lo / step) * step;
  const steps = Math.max(count, Math.ceil((hi - base) / step));
  return { lo: base, hi: base + steps * step, ticks: Array.from({ length: steps + 1 }, (_, i) => +(base + i * step).toFixed(6)) };
}

// Thin every-nth x label so they never collide.
function labelStride(n, width, per = 34) {
  return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(width / per))));
}

/**
 * Vertical bars, one series. data: [{label, value, tip}]
 */
export function barChart({ data, width, height = 170, color = 'var(--series-1)', fmt = v => v, avg = true }) {
  const padL = 38, padR = 10, padT = 12, padB = 24;
  const w = Math.max(240, width), h = height;
  const iw = w - padL - padR, ih = h - padT - padB;
  const { max, ticks } = niceScale(Math.max(...data.map(d => d.value), 0));
  const band = iw / Math.max(1, data.length);
  const bw = Math.max(3, Math.min(30, band - Math.max(2, band * 0.28)));
  const stride = labelStride(data.length, iw);
  const mean = data.length ? data.reduce((a, d) => a + d.value, 0) / data.length : 0;

  let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  for (const t of ticks) {
    const y = padT + ih - (t / max) * ih;
    svg += `<line class="grid-line" x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    svg += `<text class="axis-text" x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`;
  }
  data.forEach((d, i) => {
    const bh = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * ih);
    const x = padL + band * i + (band - bw) / 2;
    const y = padT + ih - bh;
    if (bh > 0) {
      // 4px rounded top, square foot on the baseline.
      const r = Math.min(4, bw / 2, bh);
      svg += `<path d="M${x.toFixed(1)} ${(y + bh).toFixed(1)} V${(y + r).toFixed(1)} a${r} ${r} 0 0 1 ${r} -${r} h${(bw - 2 * r).toFixed(1)} a${r} ${r} 0 0 1 ${r} ${r} V${(y + bh).toFixed(1)} Z" fill="${color}" data-tip="${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}"/>`;
    }
    // Invisible full-height hit target: easier to hover than a 3px bar.
    svg += `<rect x="${(padL + band * i).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}"/>`;
    if (i % stride === 0) {
      svg += `<text class="axis-text" x="${(padL + band * i + band / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    }
  });
  if (avg && mean > 0) {
    const y = padT + ih - (mean / max) * ih;
    svg += `<line x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 3"/>`;
    svg += `<text class="axis-text" x="${w - padR}" y="${(y - 4).toFixed(1)}" text-anchor="end">avg ${esc(fmt(mean))}</text>`;
  }
  return svg + '</svg>';
}

/**
 * Stacked bars. data: [{label, parts:{key:value}, tip}], series: [{key,label,color}]
 */
export function stackedBarChart({ data, series, width, height = 170, fmt = v => v }) {
  const padL = 34, padR = 10, padT = 12, padB = 24;
  const w = Math.max(240, width), h = height;
  const iw = w - padL - padR, ih = h - padT - padB;
  const totals = data.map(d => series.reduce((a, s) => a + (d.parts[s.key] || 0), 0));
  const { max, ticks } = niceScale(Math.max(...totals, 0));
  const band = iw / Math.max(1, data.length);
  const bw = Math.max(3, Math.min(30, band - Math.max(2, band * 0.28)));
  const stride = labelStride(data.length, iw);

  let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  for (const t of ticks) {
    const y = padT + ih - (t / max) * ih;
    svg += `<line class="grid-line" x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    svg += `<text class="axis-text" x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`;
  }
  data.forEach((d, i) => {
    const x = padL + band * i + (band - bw) / 2;
    let cursor = padT + ih;
    const tip = d.tip || `${d.label}: ${series.map(s => `${s.label} ${d.parts[s.key] || 0}`).join(', ')}`;
    series.forEach((s, si) => {
      const v = d.parts[s.key] || 0;
      if (!v) return;
      const seg = (v / max) * ih;
      const top = cursor - seg;
      const isTop = series.slice(si + 1).every(o => !(d.parts[o.key]));
      const r = isTop ? Math.min(4, bw / 2, seg) : 0;
      const gap = 2;                                   // surface gap between segments
      const drawn = Math.max(1, seg - (cursor < padT + ih ? gap : 0));
      const y = cursor - drawn;
      svg += r
        ? `<path d="M${x.toFixed(1)} ${(y + drawn).toFixed(1)} V${(y + r).toFixed(1)} a${r} ${r} 0 0 1 ${r} -${r} h${(bw - 2 * r).toFixed(1)} a${r} ${r} 0 0 1 ${r} ${r} V${(y + drawn).toFixed(1)} Z" fill="${s.color}" data-tip="${esc(tip)}"/>`
        : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${drawn.toFixed(1)}" fill="${s.color}" data-tip="${esc(tip)}"/>`;
      cursor = top;
    });
    svg += `<rect x="${(padL + band * i).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
    if (i % stride === 0) {
      svg += `<text class="axis-text" x="${(padL + band * i + band / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    }
  });
  return svg + '</svg>';
}

/**
 * Line + markers over time. points: [{x(ms), y, tip}]
 */
export function lineChart({ points, width, height = 180, color = 'var(--series-1)', fmt = v => v, xFmt }) {
  const padL = 44, padR = 12, padT = 12, padB = 24;
  const w = Math.max(240, width), h = height;
  const iw = w - padL - padR, ih = h - padT - padB;
  if (points.length === 0) return '';
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const band = niceBand(Math.min(...ys), Math.max(...ys));
  const yLo = band.lo, yHi = band.hi;
  const px = v => padL + (x1 === x0 ? iw / 2 : ((v - x0) / (x1 - x0)) * iw);
  const py = v => padT + ih - ((v - yLo) / (yHi - yLo || 1)) * ih;

  let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  for (const t of band.ticks) {
    const y = py(t);
    svg += `<line class="grid-line" x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    svg += `<text class="axis-text" x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`;
  }
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
  svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  points.forEach(p => {
    svg += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="4" fill="${color}" stroke="var(--surface-1)" stroke-width="2" data-tip="${esc(p.tip || fmt(p.y))}"/>`;
    svg += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="14" fill="transparent" data-tip="${esc(p.tip || fmt(p.y))}"/>`;
  });
  if (xFmt) {
    const first = points[0], last = points[points.length - 1];
    svg += `<text class="axis-text" x="${padL}" y="${h - 8}" text-anchor="start">${esc(xFmt(first.x))}</text>`;
    if (points.length > 1) svg += `<text class="axis-text" x="${w - padR}" y="${h - 8}" text-anchor="end">${esc(xFmt(last.x))}</text>`;
  }
  return svg + '</svg>';
}

/**
 * 24-hour rhythm: one row per day, sleep as blocks, feeds as ticks.
 * days: [{label, blocks:[{from,to,tip}], ticks:[{at,tip}]}]  (from/to/at are 0..24)
 */
export function rhythmChart({ days, width, rowH = 15, gap = 4, sleepColor = 'var(--series-1)', feedColor = 'var(--series-2)' }) {
  const padL = 36, padR = 8, padT = 14, padB = 20;
  const w = Math.max(240, width);
  const ih = days.length * (rowH + gap);
  const h = padT + ih + padB;
  const iw = w - padL - padR;
  const px = hour => padL + (hour / 24) * iw;

  let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  for (const hr of [0, 6, 12, 18, 24]) {
    svg += `<line class="grid-line" x1="${px(hr).toFixed(1)}" x2="${px(hr).toFixed(1)}" y1="${padT}" y2="${padT + ih}"/>`;
    svg += `<text class="axis-text" x="${px(hr).toFixed(1)}" y="${h - 6}" text-anchor="${hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle'}">${hr === 0 ? '12a' : hr === 24 ? '12a' : hr === 12 ? '12p' : hr > 12 ? `${hr - 12}p` : `${hr}a`}</text>`;
  }
  days.forEach((d, i) => {
    const y = padT + i * (rowH + gap);
    svg += `<rect x="${padL}" y="${y}" width="${iw}" height="${rowH}" rx="4" fill="var(--surface-2)"/>`;
    svg += `<text class="axis-text" x="${padL - 6}" y="${y + rowH - 3.5}" text-anchor="end">${esc(d.label)}</text>`;
    for (const b of d.blocks) {
      const x = px(b.from), bw = Math.max(1.5, px(b.to) - px(b.from));
      svg += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${rowH}" rx="${Math.min(4, bw / 2)}" fill="${sleepColor}" data-tip="${esc(b.tip)}"/>`;
    }
    for (const t of d.ticks) {
      svg += `<rect x="${(px(t.at) - 1.5).toFixed(1)}" y="${y + 2}" width="3" height="${rowH - 4}" rx="1.5" fill="${feedColor}" stroke="var(--surface-1)" stroke-width="1" data-tip="${esc(t.tip)}"/>`;
      svg += `<rect x="${(px(t.at) - 7).toFixed(1)}" y="${y}" width="14" height="${rowH}" fill="transparent" data-tip="${esc(t.tip)}"/>`;
    }
  });
  return svg + '</svg>';
}

export function legend(items) {
  return `<div class="viz-legend">${items.map(i =>
    `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
}

/** Wrap a builder in a titled card and keep it sized to its container. */
export function vizCard({ title, sub, build, legendItems, footer = '' }) {
  const id = 'viz-' + Math.random().toString(36).slice(2, 9);
  queueMicrotask(() => {
    const host = document.getElementById(id);
    if (!host) return;
    const draw = () => {
      const w = host.clientWidth || 320;
      host.innerHTML = build(w);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(host);
  });
  return `<section class="viz">
    <h3>${esc(title)}</h3>
    ${sub ? `<p class="viz-sub">${esc(sub)}</p>` : ''}
    <div id="${id}"></div>
    ${legendItems ? legend(legendItems) : ''}
    ${footer}
  </section>`;
}
