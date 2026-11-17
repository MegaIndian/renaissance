import type { ReactNode } from 'react';

/**
 * A card with a full sentence instead of fake content. `quiet` is the one-line form for a row that
 * is empty while another card on the screen already carries the primary action.
 */
export function EmptyState({
  title,
  description,
  action,
  art,
  quiet = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  art?: ReactNode;
  quiet?: boolean;
}) {
  if (quiet) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-3 text-body text-muted-foreground">
        {title}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center">
      {art}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-title font-semibold">{title}</h2>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
