import type { TFunction } from 'i18next';

/** "just now", "3 minutes ago", "yesterday": coarse on purpose, for the library refresh line. */
export function relativeTime(iso: string, t: TFunction, now: number = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return t('time.daysAgo', { count: Math.round(hours / 24) });
}
