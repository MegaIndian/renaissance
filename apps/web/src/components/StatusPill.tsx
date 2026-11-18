import type { RequestStatus } from '@renaissance/core';
import { useTranslation } from 'react-i18next';

/**
 * One request status as a small pill; the colour says done, failed or in progress (DESIGN.md
 * rule 4). Cancelled is muted: the person stopped it, nothing failed.
 */
export function StatusPill({ status }: { status: RequestStatus }) {
  const { t } = useTranslation();
  const tone =
    status === 'ready'
      ? 'bg-success text-success-foreground'
      : status === 'failed'
        ? 'bg-danger text-danger-foreground'
        : status === 'cancelled'
          ? 'bg-muted text-muted-foreground'
          : 'bg-muted text-foreground';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill px-2 py-0.5 text-caption ${tone}`}
    >
      {t(`requests.status.${status}`)}
    </span>
  );
}
