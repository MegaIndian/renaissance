import type {
  AskAction,
  AskResponse,
  CatalogueAlbum,
  CatalogueSearch,
  CatalogueSong,
  InstantResults,
  LibraryHit,
  NewRequest,
} from '@renaissance/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHub } from '../lib/hub';
import { Button } from './Button';
import { Icon } from './Icon';
import { PlaceholderArt } from './PlaceholderArt';
import { focusRing } from './focus';

/**
 * What the Ask bar shows under the box (F61, F75, ADR 0007 point 1): the rows of the mockup, with
 * 34 px art, title, artist · album · duration, a primary Add on songs the server does not have, a
 * ghost Play on ones it does, and the 30-second preview; then, once the hub has answered, the
 * model's cards with what each action did (or, for the app's own actions, what tapping will do)
 * and an undo. None of the rows needs the model: they come from the library and the catalogue.
 */
export function AskResults({
  instant,
  catalogue,
  answer,
  pending,
}: {
  instant: InstantResults | null;
  /** The typeahead's rows while typing; the answer's `catalogue` replaces them once it arrives. */
  catalogue: CatalogueSearch | null;
  answer: AskResponse | null;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const rows = catalogue ?? answer?.catalogue ?? null;
  const hits = instant
    ? [...instant.tracks, ...instant.albums, ...instant.artists].slice(0, 6)
    : [];
  const inLibrary = new Set(
    hits.map((h) => `${h.title.toLowerCase()}|${(h.artist ?? '').toLowerCase()}`),
  );
  const songs = (rows?.songs ?? []).filter(
    (s) => !inLibrary.has(`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`),
  );
  const albums = rows?.albums ?? [];
  const artists = (rows?.artists ?? []).slice(0, 2);
  const count = hits.length + songs.length + albums.length + artists.length;
  const off = answer?.model === 'off';
  const nothing = answer && count === 0 && answer.actions.length === 0;
  const line = !answer
    ? ''
    : nothing
      ? t('ask.noResults')
      : off
        ? answer.reason === 'budget'
          ? t('ask.budgetOff')
          : answer.reason === 'deterministic'
            ? answer.why
            : t('ask.modelOff')
        : answer.why;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {count > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="sr-only">{t('ask.results')}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
            {hits.map((hit, index) => (
              <LibraryRow key={hit.id} hit={hit} index={index} />
            ))}
            {songs.map((song, index) => (
              <SongRow key={song.id} song={song} index={hits.length + index} />
            ))}
            {albums.map((album, index) => (
              <AlbumRow key={album.id} album={album} index={hits.length + songs.length + index} />
            ))}
            {artists.map((artist, index) => (
              <li key={artist.id} className="flex items-center gap-3 px-3 py-2">
                <Art src={artist.art} index={count - artists.length + index} />
                <span className="min-w-0 flex-1 truncate text-body font-medium">{artist.name}</span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {t('ask.kind.artist')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pending ? <p className="text-caption text-muted-foreground">{t('ask.thinking')}</p> : null}
      {answer ? (
        <section className="flex flex-col gap-2">
          {answer.actions.map((action, index) => (
            <ActionCard key={`${action.tool}-${index}`} action={action} />
          ))}
          {line ? <p className="text-caption text-muted-foreground">{line}</p> : null}
          {answer.rejected.length > 0 ? (
            <p className="text-caption text-muted-foreground">
              {t('ask.rejected', { count: answer.rejected.length })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** 34 px art (DESIGN.md rule 8): the picture when there is one, else a placeholder square. */
function Art({ src, index }: { src: string | undefined; index: number }) {
  if (src) return <img src={src} alt={''} className="size-8.5 shrink-0 rounded-sm object-cover" />;
  return (
    <div className="size-8.5 shrink-0">
      <PlaceholderArt index={index} />
    </div>
  );
}

function Subtitle({ parts }: { parts: (string | undefined)[] }) {
  return (
    <span className="block truncate text-caption text-muted-foreground">
      {parts.filter((p) => p && p.length > 0).join(' · ')}
    </span>
  );
}

/** A ghost Play: the app's player performs it; disabled with a reason until one is connected. */
function PlayButton({ itemId, kind }: { itemId: string; kind: 'track' | 'album' | 'artist' }) {
  const { t } = useTranslation();
  const { perform } = useHub();
  const action: AskAction = {
    tool: 'play',
    input: { itemId, kind },
    summary: '',
    ranBy: 'app',
    undoable: true,
  };
  return (
    <Button
      tone="ghost"
      className="shrink-0"
      disabled={!perform}
      title={perform ? undefined : t('ask.playerUnavailable')}
      onClick={() => void perform?.(action, 'do')}
    >
      {t('ask.play')}
    </Button>
  );
}

function LibraryRow({ hit, index }: { hit: LibraryHit; index: number }) {
  const { t } = useTranslation();
  const { libraryArt } = useHub();
  const art = hit.imageId && libraryArt ? libraryArt(hit.imageId) : undefined;
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Art src={art} index={index} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{hit.title}</span>
        <Subtitle
          parts={[
            hit.artist,
            hit.kind === 'track' ? hit.album : t(`ask.kind.${hit.kind}`),
            hit.kind === 'track' ? formatDuration(hit.duration) : undefined,
            t('ask.inLibrary'),
          ]}
        />
      </span>
      <PlayButton itemId={hit.id} kind={hit.kind} />
    </li>
  );
}

type AddState =
  | { kind: 'idle' }
  | { kind: 'adding' }
  | { kind: 'requested'; id: string }
  | { kind: 'already'; itemId: number }
  | { kind: 'undoing' }
  | { kind: 'undone' }
  | { kind: 'failed' };

/** The add path: one tap sends the catalogue entry to the hub; the row says what happened and undoes it. */
function useAdd(input: NewRequest) {
  const { client } = useHub();
  const [state, setState] = useState<AddState>({ kind: 'idle' });
  async function add(): Promise<void> {
    if (!client) return;
    setState({ kind: 'adding' });
    try {
      const result = await client.createRequest(input);
      if ('alreadyHere' in result) setState({ kind: 'already', itemId: result.item.id });
      else setState({ kind: 'requested', id: result.id });
    } catch {
      setState({ kind: 'failed' });
    }
  }
  async function undo(): Promise<void> {
    if (!client) return;
    const previous = state;
    setState({ kind: 'undoing' });
    try {
      if (previous.kind === 'requested') await client.cancelRequest(previous.id);
      else if (previous.kind === 'already') await client.removeFromCollection(previous.itemId);
      setState({ kind: 'undone' });
    } catch {
      setState({ kind: 'failed' });
    }
  }
  return { state, add, undo, ready: client !== null };
}

function AddOutcome({ state, onUndo }: { state: AddState; onUndo: () => void }) {
  const { t } = useTranslation();
  const text =
    state.kind === 'adding'
      ? t('ask.adding')
      : state.kind === 'requested'
        ? t('ask.requested')
        : state.kind === 'already'
          ? t('ask.alreadyHere')
          : state.kind === 'undoing'
            ? t('ask.undo')
            : state.kind === 'undone'
              ? t('ask.undone')
              : t('ask.addFailed');
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="max-w-32 text-caption text-muted-foreground">{text}</span>
      {state.kind === 'requested' || state.kind === 'already' ? (
        <Button onClick={onUndo} className="shrink-0">
          {t('ask.undo')}
        </Button>
      ) : null}
    </span>
  );
}

function SongRow({ song, index }: { song: CatalogueSong; index: number }) {
  const { t } = useTranslation();
  const input: NewRequest = { kind: 'track', title: song.title, artist: song.artist };
  if (song.album) input.album = song.album;
  if (song.recordingId) input.recordingId = song.recordingId;
  if (song.releaseGroupId) input.releaseGroupId = song.releaseGroupId;
  if (song.releaseId) input.releaseId = song.releaseId;
  if (song.artistId) input.artistId = song.artistId;
  if (song.duration !== undefined) input.duration = song.duration;
  const { state, add, undo, ready } = useAdd(input);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Art src={song.art} index={index} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{song.title}</span>
        <Subtitle
          parts={[
            song.artist,
            song.album,
            formatDuration(song.duration),
            song.libraryId ? t('ask.inLibrary') : undefined,
          ]}
        />
      </span>
      {song.preview ? <Preview src={song.preview} title={song.title} /> : null}
      {song.libraryId ? (
        <PlayButton itemId={song.libraryId} kind="track" />
      ) : state.kind === 'idle' ? (
        <Button tone="primary" className="shrink-0" disabled={!ready} onClick={() => void add()}>
          {t('ask.add')}
        </Button>
      ) : (
        <AddOutcome state={state} onUndo={() => void undo()} />
      )}
    </li>
  );
}

function AlbumRow({ album, index }: { album: CatalogueAlbum; index: number }) {
  const { t } = useTranslation();
  const input: NewRequest = { kind: 'album', title: album.title, artist: album.artist };
  if (album.releaseGroupId) input.releaseGroupId = album.releaseGroupId;
  if (album.artistId) input.artistId = album.artistId;
  const { state, add, undo, ready } = useAdd(input);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Art src={album.art} index={index} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{album.title}</span>
        <Subtitle
          parts={[
            album.artist,
            album.year ? String(album.year) : undefined,
            album.libraryId ? t('ask.inLibrary') : t('ask.kind.album'),
          ]}
        />
      </span>
      {album.libraryId ? (
        <PlayButton itemId={album.libraryId} kind="album" />
      ) : state.kind === 'idle' ? (
        <Button className="shrink-0" disabled={!ready} onClick={() => void add()}>
          {t('ask.addAlbum')}
        </Button>
      ) : (
        <AddOutcome state={state} onUndo={() => void undo()} />
      )}
    </li>
  );
}

/** Deezer's 30-second preview behind a small play glyph; one plays at a time. */
function Preview({ src, title }: { src: string; title: string }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    return () => {
      audio.current?.pause();
    };
  }, []);
  function toggle(): void {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    audio.current ??= new Audio(src);
    audio.current.onended = () => setPlaying(false);
    void audio.current.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }
  return (
    <button
      type="button"
      aria-label={playing ? t('ask.stopPreview') : t('ask.preview', { title })}
      aria-pressed={playing}
      onClick={toggle}
      className={`grid size-6 shrink-0 place-items-center rounded-pill border border-border text-muted-foreground hover:text-foreground ${focusRing} ${playing ? 'bg-muted text-foreground' : ''}`}
    >
      <Icon name="play" className="size-3" />
    </button>
  );
}

type CardState = 'ready' | 'doing' | 'done' | 'undoing' | 'undone' | 'failed';

/**
 * One action. Hub actions arrive done (past tense) with an undo route. App actions arrive as an
 * instruction ("Play Carefree") with a button; once the app has performed it the card is rewritten
 * in the past tense with the app's own undo (design G).
 */
function ActionCard({ action }: { action: AskAction }) {
  const { t } = useTranslation();
  const { client, perform } = useHub();
  const app = action.ranBy === 'app';
  const [state, setState] = useState<CardState>(app ? 'ready' : 'done');
  const canUndoHub = !app && action.undoable && action.undo !== undefined && client !== null;
  async function run(direction: 'do' | 'undo'): Promise<void> {
    setState(direction === 'do' ? 'doing' : 'undoing');
    try {
      if (app) await perform?.(action, direction);
      else if (client) await client.undo(action);
      setState(direction === 'do' ? 'done' : 'undone');
    } catch {
      setState('failed');
    }
  }
  const summary = app && (state === 'done' || state === 'undoing') ? action.doneSummary : undefined;
  const caption =
    state === 'undone'
      ? t('ask.undone')
      : state === 'failed'
        ? t('ask.undoFailed')
        : app && !perform
          ? t('ask.playerUnavailable')
          : undefined;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-body">{summary ?? action.summary}</span>
        {caption ? <span className="text-caption text-muted-foreground">{caption}</span> : null}
      </div>
      {app && state === 'ready' ? (
        <Button className="shrink-0" disabled={!perform} onClick={() => void run('do')}>
          {t(`ask.do.${action.tool}`)}
        </Button>
      ) : null}
      {(app && state === 'done' && action.undoable && perform) ||
      (canUndoHub && state === 'done') ? (
        <Button onClick={() => void run('undo')} className="shrink-0">
          {t('ask.undo')}
        </Button>
      ) : null}
    </div>
  );
}
