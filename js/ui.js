// Small DOM helpers: toasts, bottom sheets, confirm dialog, tooltip layer.

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Inline sprite icon: icon('i-feed') or icon('i-plus', 'sm'). */
export function icon(id, cls = '') {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Bottom sheet. `body` is HTML; resolves with whatever close(value) is called with,
 * or null when dismissed.
 */
export function sheet({ title, body, actions = [], onMount } = {}) {
  return new Promise(resolve => {
    const root = document.getElementById('sheet-root');
    const back = h(`<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      <div class="sheet-body">${body}</div>
      <div class="row sheet-actions"></div>
    </div></div>`);
    const close = value => {
      document.removeEventListener('keydown', onKey);
      back.remove();
      resolve(value ?? null);
    };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', e => { if (e.target === back) close(null); });

    const actionRow = back.querySelector('.sheet-actions');
    const all = [...actions, { label: 'Cancel', cls: 'ghost', value: null }];
    all.forEach(a => {
      const b = h(`<button type="button" class="btn ${a.cls || ''}">${esc(a.label)}</button>`);
      b.addEventListener('click', async () => {
        if (a.onClick) {
          const v = await a.onClick(back.querySelector('.sheet-body'), close);
          if (v === false) return;                     // validation failed: stay open
          close(v);
        } else close(a.value);
      });
      actionRow.append(b);
    });

    root.append(back);
    if (onMount) onMount(back.querySelector('.sheet-body'), close);
    const first = back.querySelector('input, select, textarea, button');
    if (first && !('ontouchstart' in window)) first.focus();
  });
}

export async function confirm(message, { danger = true, okLabel = 'Delete' } = {}) {
  const res = await sheet({
    title: message,
    body: '',
    actions: [{ label: okLabel, cls: danger ? 'danger' : 'primary', value: true }],
  });
  return res === true;
}

/* Hover/press tooltips for any [data-tip] element, one listener for the page. */
export function initTooltips() {
  const tip = document.getElementById('tooltip');
  let hideTimer;
  const show = (target, x, y) => {
    tip.textContent = target.getAttribute('data-tip');
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const top = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => { tip.hidden = true; };

  document.addEventListener('pointermove', e => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return hide();
    show(t, e.clientX, e.clientY);
  }, { passive: true });

  document.addEventListener('pointerdown', e => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    show(t, e.clientX, e.clientY);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 2500);
  }, { passive: true });

  document.addEventListener('scroll', hide, { passive: true, capture: true });
}

/**
 * Hand a file to the OS. On iOS the share sheet is the useful path (AirDrop,
 * Messages, Files, Mail); everywhere else this falls back to a download.
 * Returns 'shared' | 'cancelled' | 'downloaded'.
 */
export async function shareOrDownload(filename, text, mime = 'text/csv') {
  try {
    const file = new File([text], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    // Anything else: fall through to a plain download.
  }
  download(filename, text, mime);
  return 'downloaded';
}

/** Trigger a client-side file download. */
export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read an image file, centre-crop it square and shrink it, returning a JPEG
 * data URL small enough to live on the profile record (and so sync for free).
 */
export async function squarePhoto(file, size = 200, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2, sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  let url = canvas.toDataURL('image/jpeg', quality);
  if (url.length > 60000) url = canvas.toDataURL('image/jpeg', 0.6);   // busy photo: squeeze harder
  return url;
}
