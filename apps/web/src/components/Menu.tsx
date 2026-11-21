import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import type { IconName } from './Icon';
import { useScrollContainer } from './ScrollContainer';
import { focusRing } from './focus';

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName | undefined;
  onSelect: () => void;
  disabled?: boolean | undefined;
  /** A hint shown under the label, for disabled items that arrive in a later phase. */
  hint?: string | undefined;
  tone?: 'default' | 'danger' | undefined;
}

/**
 * A popover menu with full keyboard support: arrows move, Home and End jump, Escape and outside
 * clicks close, focus returns to the trigger. Items are plain buttons with `role="menuitem"`. The
 * list opens below the trigger, or above it when the scroll container's visible area has no room
 * below (the last rows of a phone list) and more room above.
 */
export function Menu({
  label,
  items,
  icon = 'more',
  align = 'end',
  trigger,
  className = '',
}: {
  label: string;
  items: MenuItem[];
  icon?: IconName;
  align?: 'start' | 'end';
  /** Replace the default icon button with custom trigger content. */
  trigger?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useScrollContainer();

  // Placed before paint, on the element itself: the list must exist to be measured, and a state
  // round trip here would draw it below first.
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    const above = flipsAbove(button.current, el, scroller?.current ?? null);
    el.classList.toggle('bottom-full', above);
    el.classList.toggle('mb-1', above);
    el.classList.toggle('mt-1', !above);
    el.dataset['placement'] = above ? 'above' : 'below';
  }, [open, scroller]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent): void => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    const first = list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const focusAt = (index: number): void => {
      const next = (index + enabled.length) % enabled.length;
      setActive(next);
      list.current
        ?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
        [next]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(active + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(active - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(enabled.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
        break;
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        className={
          trigger
            ? `inline-flex min-h-6 items-center gap-1 rounded-sm text-body ${focusRing}`
            : `grid size-8 min-h-6 min-w-6 shrink-0 place-items-center rounded-pill text-muted-foreground hover:bg-muted hover:text-foreground ${focusRing}`
        }
      >
        {trigger ?? <Icon name={icon} className="size-4" />}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`absolute z-20 mt-1 flex min-w-48 max-w-72 flex-col rounded-md border border-border bg-card p-1 shadow-low ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
          data-placement="below"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                button.current?.focus();
                item.onSelect();
              }}
              className={`flex min-h-6 w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-body ${focusRing} ${
                item.disabled
                  ? 'cursor-not-allowed text-muted-foreground'
                  : item.tone === 'danger'
                    ? 'text-danger hover:bg-muted'
                    : 'text-foreground hover:bg-muted'
              }`}
            >
              {item.icon ? <Icon name={item.icon} className="mt-0.5 size-4" /> : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.label}</span>
                {item.hint ? (
                  <span className="text-caption text-muted-foreground">{item.hint}</span>
                ) : null}
              </span>
            </button>
          ))}
          <span className="sr-only">{t('actions.menu')}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The gap between the trigger and the list, in CSS pixels (`mt-1` / `mb-1`). */
const GAP_PX = 4;

/**
 * Whether the list fits better above the trigger: it would cross the scroll container's visible
 * bottom (the viewport's when there is no container) and the room above is larger.
 */
export function flipsAbove(
  trigger: HTMLElement | null,
  menu: HTMLElement | null,
  container: HTMLElement | null,
): boolean {
  if (!trigger || !menu) return false;
  const anchor = trigger.getBoundingClientRect();
  const height = menu.getBoundingClientRect().height;
  const bounds = container?.getBoundingClientRect();
  const top = bounds?.top ?? 0;
  const bottom = bounds?.bottom ?? window.innerHeight;
  const roomBelow = bottom - anchor.bottom;
  const roomAbove = anchor.top - top;
  return height + GAP_PX > roomBelow && roomAbove > roomBelow;
}
