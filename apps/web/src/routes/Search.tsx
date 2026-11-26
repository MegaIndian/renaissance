import { isEmptyResult } from '@renaissance/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { useLibrary, useSession } from '../lib/queries';
import { recentSearchesStore } from '../lib/recent';
import { useStoreValue } from '../lib/useStore';
import { AlbumCard, ArtistCard, PlaylistCard } from '../components/Cards';
import { EmptyState } from '../components/EmptyState';
import { Row, RowItem } from '../components/Row';
import { SignedOut } from '../components/SignedOut';
import { focusRing } from '../components/focus';
import { TrackList } from './Library';

/** The full results page behind the Ask bar's instant list (F11): every match, by kind. */
export function Search() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const term = params.get('q')?.trim() ?? '';
  const { index, ready } = useLibrary();
  const session = useSession();
  const recent = useStoreValue(recentSearchesStore);
  const results = useMemo(() => (term ? index.search(term, 50) : null), [index, term]);

  // No session, no index to search: the Library's sentence and Sign in (design AG).
  if (session.status === 'signedOut') return <SignedOut title={t('search.title')} />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-heading font-semibold">
        {term ? t('search.resultsFor', { term }) : t('search.title')}
      </h1>
      {!term ? (
        <>
          <EmptyState title={t('search.empty')} quiet />
          {recent.length ? (
            <section className="flex flex-col gap-2" aria-label={t('search.recent')}>
              <h2 className="text-label font-medium text-muted-foreground">{t('search.recent')}</h2>
              <ul className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <li key={r}>
                    <Link
                      to={`/search?q=${encodeURIComponent(r)}`}
                      className={`inline-flex min-h-6 items-center rounded-pill border border-border bg-secondary px-3 py-1 text-caption ${focusRing}`}
                    >
                      {r}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : results && isEmptyResult(results) ? (
        ready ? (
          <EmptyState title={t('search.noResults', { term })} quiet />
        ) : null
      ) : results ? (
        <>
          {results.artists.length ? (
            <Row title={t('search.artists')} empty="" count={results.artists.length}>
              {results.artists.map((a) => (
                <RowItem key={a.id}>
                  <ArtistCard artist={a} />
                </RowItem>
              ))}
            </Row>
          ) : null}
          {results.albums.length ? (
            <Row title={t('search.albums')} empty="" count={results.albums.length}>
              {results.albums.map((a) => (
                <RowItem key={a.id}>
                  <AlbumCard album={a} />
                </RowItem>
              ))}
            </Row>
          ) : null}
          {results.playlists.length ? (
            <Row title={t('search.playlists')} empty="" count={results.playlists.length}>
              {results.playlists.map((p) => (
                <RowItem key={p.id}>
                  <PlaylistCard playlist={p} />
                </RowItem>
              ))}
            </Row>
          ) : null}
          {results.tracks.length ? (
            <section className="flex flex-col gap-2" aria-label={t('search.tracks')}>
              <h2 className="text-heading font-semibold">{t('search.tracks')}</h2>
              <TrackList tracks={results.tracks} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
