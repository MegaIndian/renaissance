import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { focusRing } from './focus';

/** A small modal card: labelled, Escape and the close button dismiss it, focus moves in and back out. */
export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = card.current?.querySelector<HTMLElement>(
      'input, button:not([aria-label="' + t('actions.close') + '"]), [tabindex]',
    );
    (first ?? card.current)?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && card.current) {
        const focusable = [
          ...card.current.querySelectorAll<HTMLElement>('input, button, [tabindex]'),
        ].filter((el) => !el.hasAttribute('disabled'));
        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        if (!firstEl || !lastEl) return;
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose, t]);
  return (
    <div
      className="fixed inset-0 z-30 grid place-items-end bg-background/60 p-4 sm:place-items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-low outline-none"
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={`${id}-title`} className="text-title font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={`${id}-desc`} className="text-body text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t('actions.close')}
            onClick={onClose}
            className={`grid size-8 shrink-0 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
