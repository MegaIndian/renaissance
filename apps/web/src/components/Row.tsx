import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { EmptyState } from './EmptyState';
import { focusRing } from './focus';

/**
 * A home row: heading, optional "see all" link, and a horizontal scroller of cards. An empty row
 * is one quiet EmptyState sentence, never a grid of placeholders (DESIGN.md rule 3).
 */
export function Row({
  title,
  to,
  toLabel,
  empty,
  emptyBody,
  children,
  count,
}: {
  title: string;
  to?: string;
  toLabel?: string;
  empty: string;
  emptyBody?: string | undefined;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-heading font-semibold">{title}</h2>
        {to && count > 0 ? (
          <Link
            to={to}
            className={`inline-flex min-h-6 items-center rounded-sm px-2 text-caption text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            {toLabel}
          </Link>
        ) : null}
      </div>
      {count === 0 ? (
        emptyBody ? (
          <EmptyState title={empty} description={emptyBody} />
        ) : (
          <EmptyState title={empty} quiet />
        )
      ) : (
        <div className="-mx-2 flex snap-x gap-2 overflow-x-auto px-2 pb-1">{children}</div>
      )}
    </section>
  );
}

/** A fixed-width slot inside a Row so cards line up at every width. */
export function RowItem({ children }: { children: ReactNode }) {
  return <div className="w-36 shrink-0 snap-start sm:w-40">{children}</div>;
}
