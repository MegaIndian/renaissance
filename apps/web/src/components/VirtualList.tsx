import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useScrollContainer } from './ScrollContainer';

const FALLBACK_RECT = { width: 1024, height: 1200 };

/**
 * A list that renders only the rows in view, scrolling with the shell's `main` (F14: 20,000 songs
 * scroll smoothly). Rows are fixed-height on the token grid; `columns` turns it into a grid.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  columns = 1,
  gap = 0,
  renderItem,
  keyOf,
  role = 'list',
  label,
  className = '',
}: {
  items: readonly T[];
  rowHeight: number;
  columns?: number;
  gap?: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyOf: (item: T, index: number) => string;
  role?: 'list' | 'grid';
  label?: string;
  className?: string;
}) {
  const container = useScrollContainer();
  const outer = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const rows = Math.ceil(items.length / columns);

  useLayoutEffect(() => {
    const scroller = container?.current;
    const el = outer.current;
    if (!scroller || !el) return;
    const measure = (): void => {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setMargin(Math.max(0, Math.round(top + scroller.scrollTop)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [container]);

  // TanStack Virtual's hook returns a mutable instance; the React Compiler must leave it alone.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => container?.current ?? null,
    estimateSize: () => rowHeight + gap,
    overscan: 6,
    scrollMargin: margin,
    initialRect: FALLBACK_RECT,
    // A container that measures zero (not laid out yet, or a test DOM) is treated as a tall viewport.
    observeElementRect: (instance, callback) => {
      const el = instance.scrollElement;
      if (!el) return undefined;
      const measure = (): void => {
        const rect = el.getBoundingClientRect();
        callback(rect.height > 0 ? { width: rect.width, height: rect.height } : FALLBACK_RECT);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    },
  });

  const total = virtualizer.getTotalSize();
  return (
    <div
      ref={outer}
      role={role}
      aria-label={label}
      aria-rowcount={role === 'grid' ? rows : undefined}
      className={`relative w-full ${className}`}
      style={{ height: total }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * columns;
        const slice = items.slice(start, start + columns);
        return (
          <div
            key={row.key}
            role={role === 'grid' ? 'row' : undefined}
            className={columns > 1 ? 'absolute left-0 grid w-full' : 'absolute left-0 w-full'}
            style={{
              top: row.start - margin,
              height: rowHeight,
              ...(columns > 1
                ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: gap }
                : {}),
            }}
          >
            {slice.map((item, i) => (
              <div
                key={keyOf(item, start + i)}
                role={role === 'grid' ? 'gridcell' : 'listitem'}
                className="min-w-0"
              >
                {renderItem(item, start + i)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Columns for a card grid at the current width, read from the container. */
export function useColumns(
  minCardWidth: number,
  gap: number,
): [number, (el: HTMLElement | null) => void] {
  const [columns, setColumns] = useState(2);
  const observed = useRef<ResizeObserver | null>(null);
  const setRef = (el: HTMLElement | null): void => {
    observed.current?.disconnect();
    if (!el) return;
    const compute = (): void => {
      const width = el.clientWidth;
      setColumns(Math.max(1, Math.floor((width + gap) / (minCardWidth + gap))));
    };
    compute();
    observed.current = new ResizeObserver(compute);
    observed.current.observe(el);
  };
  return [columns, setRef];
}
