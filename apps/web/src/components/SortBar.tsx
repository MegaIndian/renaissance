import { sortKeys } from '@renaissance/core';
import type { SortKey, SortOrder } from '@renaissance/core';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Menu } from './Menu';
import { SegmentedControl } from './SegmentedControl';
import { focusRing } from './focus';

export type View = 'grid' | 'list';

const sortLabelKey: Record<SortKey, string> = {
  name: 'library.sortName',
  dateAdded: 'library.sortDateAdded',
  year: 'library.sortYear',
  playCount: 'library.sortPlayCount',
  lastPlayed: 'library.sortLastPlayed',
  random: 'library.sortRandom',
  lastSaved: 'library.sortDateAdded',
};

/** Sort, order, view and filters in one line (F15); advanced mode only, simple mode uses the defaults. */
export function SortBar({
  sort,
  order,
  onSort,
  view,
  onView,
  allowedSorts = sortKeys,
  favoritesOnly,
  onFavoritesOnly,
  genres,
  genre,
  onGenre,
  years,
  year,
  onYear,
  onClear,
}: {
  sort: SortKey;
  order: SortOrder;
  onSort: (sort: SortKey, order: SortOrder) => void;
  view?: View;
  onView?: (view: View) => void;
  allowedSorts?: readonly SortKey[];
  favoritesOnly?: boolean;
  onFavoritesOnly?: (value: boolean) => void;
  genres?: string[];
  genre?: string | null;
  onGenre?: (genre: string | null) => void;
  years?: number[];
  year?: number | null;
  onYear?: (year: number | null) => void;
  /** Clears every filter in one state update. */
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const hasFilters = favoritesOnly || genre || year;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="toolbar"
      aria-label={t('library.sort')}
    >
      <Menu
        label={t('library.sortBy')}
        icon="sort"
        align="start"
        trigger={
          <span className="inline-flex min-h-6 items-center gap-1 rounded-sm border border-border bg-secondary px-2 py-1 text-caption text-secondary-foreground">
            <Icon name="sort" className="size-3.5" />
            {t(sortLabelKey[sort])}
            <Icon name={order === 'asc' ? 'arrowUp' : 'arrowDown'} className="size-3.5" />
          </span>
        }
        items={[
          ...allowedSorts.map((key) => ({
            key,
            label: t(sortLabelKey[key]),
            icon: (key === sort ? 'check' : undefined) as 'check' | undefined,
            onSelect: () => onSort(key, key === sort ? order : key === 'name' ? 'asc' : 'desc'),
          })),
          {
            key: 'order',
            label: order === 'asc' ? t('library.orderDesc') : t('library.orderAsc'),
            icon: order === 'asc' ? 'arrowDown' : 'arrowUp',
            onSelect: () => onSort(sort, order === 'asc' ? 'desc' : 'asc'),
            disabled: sort === 'random',
          },
        ]}
      />
      {onFavoritesOnly ? (
        <button
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => onFavoritesOnly(!favoritesOnly)}
          className={`inline-flex min-h-6 items-center gap-1 rounded-sm border px-2 py-1 text-caption ${focusRing} ${
            favoritesOnly
              ? 'border-primary bg-muted text-foreground'
              : 'border-border bg-secondary text-secondary-foreground'
          }`}
        >
          <Icon name={favoritesOnly ? 'heartFilled' : 'heart'} className="size-3.5" />
          {t('library.filterFavorites')}
        </button>
      ) : null}
      {onGenre && genres && genres.length ? (
        <Menu
          label={t('library.filterGenre')}
          icon="filter"
          align="start"
          trigger={
            <span
              className={`inline-flex min-h-6 items-center gap-1 rounded-sm border px-2 py-1 text-caption ${genre ? 'border-primary bg-muted text-foreground' : 'border-border bg-secondary text-secondary-foreground'}`}
            >
              <Icon name="filter" className="size-3.5" />
              {genre ?? t('library.filterGenre')}
            </span>
          }
          items={[
            {
              key: 'all',
              label: t('library.filterAll'),
              icon: genre ? undefined : 'check',
              onSelect: () => onGenre(null),
            },
            ...genres.map((g) => ({
              key: g,
              label: g,
              icon: (g === genre ? 'check' : undefined) as 'check' | undefined,
              onSelect: () => onGenre(g),
            })),
          ]}
        />
      ) : null}
      {onYear && years && years.length ? (
        <Menu
          label={t('library.filterYear')}
          icon="filter"
          align="start"
          trigger={
            <span
              className={`inline-flex min-h-6 items-center gap-1 rounded-sm border px-2 py-1 text-caption ${year ? 'border-primary bg-muted text-foreground' : 'border-border bg-secondary text-secondary-foreground'}`}
            >
              <Icon name="filter" className="size-3.5" />
              {year ?? t('library.filterYear')}
            </span>
          }
          items={[
            {
              key: 'all',
              label: t('library.filterAll'),
              icon: year ? undefined : 'check',
              onSelect: () => onYear(null),
            },
            ...years.map((y) => ({
              key: String(y),
              label: String(y),
              icon: (y === year ? 'check' : undefined) as 'check' | undefined,
              onSelect: () => onYear(y),
            })),
          ]}
        />
      ) : null}
      {hasFilters ? (
        <button
          type="button"
          onClick={() => {
            if (onClear) onClear();
            else {
              onFavoritesOnly?.(false);
              onGenre?.(null);
              onYear?.(null);
            }
          }}
          className={`min-h-6 rounded-sm px-2 py-1 text-caption text-muted-foreground hover:text-foreground ${focusRing}`}
        >
          {t('library.clearFilters')}
        </button>
      ) : null}
      {view && onView ? (
        <div className="ml-auto">
          <SegmentedControl
            label={t('library.view')}
            value={view}
            options={[
              { value: 'grid', label: t('library.viewGrid') },
              { value: 'list', label: t('library.viewList') },
            ]}
            onChange={onView}
          />
        </div>
      ) : null}
    </div>
  );
}
