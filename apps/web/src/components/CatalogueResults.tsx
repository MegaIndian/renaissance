import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { addsStore, hubStore, requestsStore, rowStatus } from '../lib/hub';
import type { CatalogueRow } from '../lib/hub';
import { useLibrary } from '../lib/queries';
import { useCatalogue } from '../lib/useCatalogue';
import { useStoreValue } from '../lib/useStore';
import { chooseCatalogue, localFor } from './AskBar';
import { Button } from './Button';
import { PreviewButton, RemoteArt, RowGlyph, rowHeading, rowSubtitle } from './CatalogueRow';

/**
 * The catalogue under the library results on the search page (F61): the full search, MusicBrainz
 * waited for, so the song typed is there when it exists. One Add per row; the first song that is
 * the one typed wears the screen's one blue (DESIGN.md rule 1), and when the hub says no row is
 * (only other takes, a busy catalogue) every Add stays secondary and a line says why.
 */
export function CatalogueResults({ term }: { term: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { index } = useLibrary();
  const hub = useStoreValue(hubStore);
  const adds = useStoreValue(addsStore);
  const requests = useStoreValue(requestsStore);
  const { result, loading, failed } = useCatalogue(hub.client ? term : '', { full: true });
  if (!hub.client || term.trim().length < 2) return null;

  const rows: CatalogueRow[] = result
    ? [
        ...result.songs.map((item): CatalogueRow => ({ kind: 'song', item })),
        ...result.albums.map((item): CatalogueRow => ({ kind: 'album', item })),
      ]
    : [];
  // The hub orders the song typed first: that row, while it can still be added, is the one blue.
  const firstSong = rows.findIndex((r) => r.kind === 'song');
  const primary =
    result?.exact !== false &&
    firstSong !== -1 &&
    rowStatus(rows[firstSong]!, adds, requests).kind === 'none'
      ? firstSong
      : -1;
  const note = failed
    ? t('catalogue.hubAwayHint')
    : result?.busy
      ? t('catalogue.headingBusy')
      : result && result.exact === false && rows.length
        ? t('catalogue.otherVersions')
        : '';

  return (
    <section className="flex flex-col gap-2" aria-label={t('catalogue.heading')}>
      <h2 className="text-heading font-semibold">{t('catalogue.heading')}</h2>
      {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
      {loading && !result ? (
        <div
          role="progressbar"
          aria-label={t('catalogue.looking')}
          className="h-1 w-full overflow-hidden rounded-pill bg-muted"
        >
          <div className="h-full w-1/3 animate-pulse rounded-pill bg-info" />
        </div>
      ) : null}
      {result && !rows.length ? (
        <p className="text-body text-muted-foreground">{t('catalogue.noMatch')}</p>
      ) : null}
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
          {rows.map((row, i) => {
            const status = rowStatus(row, adds, requests);
            const { title } = rowHeading(row);
            const canAdd = status.kind === 'none' || status.kind === 'failed';
            const canPlay =
              (status.kind === 'ready' || status.kind === 'already') && !!localFor(row, index);
            return (
              <li key={row.item.id} className="flex items-center gap-3 px-3 py-2">
                <RemoteArt src={row.item.art} index={i} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium">{title}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {rowSubtitle(row, status, t)}
                  </span>
                </span>
                {row.kind === 'song' && row.item.preview ? (
                  <PreviewButton src={row.item.preview} title={row.item.title} />
                ) : null}
                {canAdd || canPlay ? (
                  <Button
                    tone={i === primary ? 'primary' : canPlay ? 'ghost' : 'secondary'}
                    className="shrink-0"
                    aria-label={
                      canAdd
                        ? t(
                            row.kind === 'album' ? 'catalogue.addAlbumLabel' : 'catalogue.addLabel',
                            {
                              title: row.item.title,
                              artist: row.item.artist,
                            },
                          )
                        : t('catalogue.playLabel', { title: row.item.title })
                    }
                    onClick={() =>
                      chooseCatalogue(row, status, { index, navigate, t, onPlayed: () => {} })
                    }
                  >
                    {canAdd
                      ? row.kind === 'album'
                        ? t('catalogue.addAlbum')
                        : t('catalogue.add')
                      : t('catalogue.play')}
                  </Button>
                ) : (
                  <RowGlyph status={status} />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
