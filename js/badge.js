/**
 * The Home Screen icon's badge: shown while a sleep is running (or paused),
 * cleared when the baby is awake. iOS lets an installed web app set only a
 * badge, never the icon itself. The other phone's badge follows the same push
 * that notifies it (see sw.js). Off via the switch in More → Notifications.
 */
import { db } from './db.js';

export const badgeSupported = 'setAppBadge' in navigator;

export async function badgeEnabled() { return (await db.metaGet('badgeSleep', true)) !== false; }
export async function setBadgeEnabled(on) { await db.metaSet('badgeSleep', !!on); }

/** Make the badge match the current sleep state. Safe to call often; no network. */
export async function syncBadge(activeSleep) {
  if (!badgeSupported) return;
  try {
    if (activeSleep && await badgeEnabled()) await navigator.setAppBadge(1);
    else await navigator.clearAppBadge();
  } catch { /* not installed, or permission missing: nothing to show */ }
}
