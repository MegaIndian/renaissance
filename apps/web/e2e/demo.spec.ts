import { chartInk } from '@renaissance/design';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { channelDistance, hexToRgb, inkOnSwatch, renderedPixels } from './lib/pixels';

/**
 * The phase 1 exit test against a real Jellyfin (the demo container with the four Kevin MacLeod
 * tracks): sign in, browse, play, favourite, make a playlist, reorder it, and check the server agrees.
 * Needs RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD in the environment;
 * without them the whole file is skipped with the reason (CI has no route to the NAS, see
 * docs/testing.md). Values are read, never printed. The demo user is an administrator, which the
 * second-user test needs; it creates and deletes that user itself.
 */
const url = process.env['RENAISSANCE_DEMO_URL'];
const userName = process.env['RENAISSANCE_DEMO_USER'];
const password = process.env['RENAISSANCE_DEMO_PASSWORD'];
const configured = !!(url && userName && password);

interface JfTrack {
  Id: string;
  Name: string;
  ArtistItems?: { Id: string; Name: string }[];
  UserData: { PlayCount: number; IsFavorite: boolean };
}

test.describe('against the demo Jellyfin', () => {
  test.skip(
    !configured,
    'RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD are not set; the demo server is on the home LAN, so CI skips this file.',
  );
  test.describe.configure({ mode: 'serial' });

  async function api<T>(
    path: string,
    init: RequestInit = {},
    token?: string,
    deviceId = 'pw-e2e',
  ): Promise<T> {
    const auth = `MediaBrowser Client="Renaissance e2e", Device="Playwright", DeviceId="${deviceId}", Version="0.0.0"${token ? `, Token="${token}"` : ''}`;
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Jellyfin keeps one token per device, so a second user signs in from its own device id. */
  async function authenticate(name: string, pw: string, deviceId = 'pw-e2e') {
    return api<{ AccessToken: string; User: { Id: string } }>(
      '/Users/AuthenticateByName',
      { method: 'POST', body: JSON.stringify({ Username: name, Pw: pw }) },
      undefined,
      deviceId,
    );
  }

  /** Server-side state, read with its own session so the browser's reports are what is measured. */
  async function serverState(): Promise<{
    token: string;
    userId: string;
    tracks: JfTrack[];
    playlists: { Id: string; Name: string }[];
    artists: { Id: string; Name: string }[];
  }> {
    const auth = await authenticate(userName ?? '', password ?? '');
    const token = auth.AccessToken;
    const userId = auth.User.Id;
    const items = await api<{ Items: JfTrack[] }>(
      `/Items?userId=${userId}&IncludeItemTypes=Audio&Recursive=true&SortBy=SortName`,
      {},
      token,
    );
    const lists = await api<{ Items: never[] }>(
      `/Items?userId=${userId}&IncludeItemTypes=Playlist&Recursive=true`,
      {},
      token,
    );
    const artists = await api<{ Items: never[] }>(`/Artists?userId=${userId}`, {}, token);
    return { token, userId, tracks: items.Items, playlists: lists.Items, artists: artists.Items };
  }

  async function playlistOrder(playlistId: string): Promise<string[]> {
    const state = await serverState();
    const items = await api<{ Items: { Name: string }[] }>(
      `/Playlists/${playlistId}/Items?userId=${state.userId}`,
      {},
      state.token,
    );
    return items.Items.map((i) => i.Name);
  }

  async function signIn(page: Page): Promise<void> {
    await page.goto('/sign-in?lang=en&theme=dark');
    await page.getByRole('textbox', { name: 'Server address' }).fill(url ?? '');
    await page.getByRole('textbox', { name: 'User name' }).fill(userName ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`, ${userName}`);
  }

  async function openTracks(page: Page, mode = 'simple'): Promise<void> {
    await page.goto(`/library?section=tracks&lang=en&theme=dark&mode=${mode}`);
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
  }

  const playCount = async (id: string | undefined) =>
    (await serverState()).tracks.find((t) => t.Id === id)?.UserData.PlayCount ?? -1;

  test.beforeEach(async () => {
    // Leave no favourites or test playlists behind from an earlier run.
    const state = await serverState();
    for (const t of state.tracks) {
      if (t.UserData.IsFavorite) {
        await api(
          `/UserFavoriteItems/${t.Id}?userId=${state.userId}`,
          { method: 'DELETE' },
          state.token,
        );
      }
    }
    for (const p of state.playlists) {
      if (p.Name.startsWith('e2e ')) await api(`/Items/${p.Id}`, { method: 'DELETE' }, state.token);
    }
    const users = await api<{ Id: string; Name: string }[]>('/Users', {}, state.token);
    for (const u of users) {
      if (u.Name.startsWith('e2e-user-'))
        await api(`/Users/${u.Id}`, { method: 'DELETE' }, state.token);
    }
  });

  test('signs in, browses the four tracks and the artist by every id, plays one, and a reload is not a play', async ({
    page,
  }) => {
    const before = await serverState();
    expect(before.tracks).toHaveLength(4);
    await signIn(page);

    // The library comes from the cache after the first sync; four songs, sorted by name.
    await openTracks(page);
    const titles = ['Carefree', 'Fluffing a Duck', 'Monkeys Spinning Monkeys', 'Sneaky Snitch'];
    for (const title of titles) {
      await expect(page.getByRole('button', { name: `Play ${title}` })).toBeVisible();
    }

    // The placeholder art in a row is the row's square: as tall as it is wide, inside the row.
    const row = page.getByRole('button', { name: 'Play Carefree' }).locator('..');
    const art = row.getByTestId('placeholder-art').first();
    const artBox = (await art.boundingBox()) ?? { width: 0, height: 0 };
    const rowBox = (await row.boundingBox()) ?? { width: 0, height: 0 };
    const root = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(Math.abs(artBox.width - artBox.height)).toBeLessThan(1);
    expect(Math.abs(artBox.width - root * 2.25)).toBeLessThan(1);
    expect(artBox.height).toBeLessThan(rowBox.height);
    expect(Math.abs(rowBox.height - root * 3.5)).toBeLessThan(1);

    // One artist in the grid, with every song, however many ids the server holds for the name.
    await page.getByRole('radio', { name: 'Artists' }).click();
    await expect(page.getByText('1 artist')).toBeVisible();
    await page.getByRole('link', { name: 'Kevin MacLeod' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kevin MacLeod' })).toBeVisible();
    await expect(page.getByText('4 songs')).toBeVisible();
    await expect(page.getByText('1 album')).toBeVisible();

    // The same page by the id the tracks carry and by the id `/Artists` lists: both resolve.
    const ids = new Set<string>();
    for (const t of before.tracks) for (const a of t.ArtistItems ?? []) ids.add(a.Id);
    for (const a of before.artists) ids.add(a.Id);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      await page.goto(`/artist/${id}?lang=en&theme=dark`);
      await expect(page.getByRole('heading', { level: 1, name: 'Kevin MacLeod' })).toBeVisible();
      await expect(page.getByText('4 songs')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play all' })).toBeEnabled();
    }
    // And from the album's artist link.
    await page.goto('/library?section=albums&lang=en&theme=dark');
    await page
      .getByRole('link', { name: /Kevin MacLeod/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Kevin MacLeod' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kevin MacLeod' })).toBeVisible();
    await expect(page.getByText('4 songs')).toBeVisible();

    // With the server down the artist page still comes from the cache.
    await page.route(`${url}/**`, (route) => route.abort());
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Kevin MacLeod' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('4 songs')).toBeVisible();
    await page.unroute(`${url}/**`);

    // Play the shortest track from the songs list (sorted by name, so a next track follows it) and
    // let the browser report to the server.
    await openTracks(page);
    await page.getByRole('button', { name: 'Play Fluffing a Duck' }).click();
    const bar = page.getByRole('contentinfo');
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(
      'Fluffing a Duck',
    );
    await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
    const position = page.getByRole('slider', { name: 'Position' });
    await expect
      .poll(async () => Number(await position.inputValue()), { timeout: 15_000 })
      .toBeGreaterThan(1);

    // Seek to the end with the keyboard: the track ends, the queue moves on, the server gets Stopped.
    await position.focus();
    await page.keyboard.press('End');
    await expect(bar.getByRole('link', { name: 'Open now playing' })).not.toContainText(
      'Fluffing a Duck',
      { timeout: 20_000 },
    );
    await bar.getByRole('button', { name: 'Pause' }).click();

    const duck = before.tracks.find((t) => t.Name === 'Fluffing a Duck');
    await expect
      .poll(() => playCount(duck?.Id), { timeout: 15_000 })
      .toBeGreaterThan(duck?.UserData.PlayCount ?? 0);

    // The queue survives a reload (F22): the bar comes back with the same track, paused, and
    // nothing is reported: three reloads do not raise the play count of the restored track.
    const nowShowing = await bar.getByRole('link', { name: 'Open now playing' }).innerText();
    const restoredTitle = nowShowing.split('\n')[0] ?? '';
    const restored = before.tracks.find((t) => t.Name === restoredTitle);
    const restoredCount = await playCount(restored?.Id);
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(
        restoredTitle,
        { timeout: 15_000 },
      );
      await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
    }
    await page.waitForTimeout(3000);
    expect(await playCount(restored?.Id)).toBe(restoredCount);
  });

  test('favourites a song and the server agrees; the heart survives a reload', async ({ page }) => {
    await signIn(page);
    await openTracks(page);
    const row = page.getByRole('listitem').filter({ hasText: 'Carefree' });
    await row.getByRole('button', { name: 'Add to favourites' }).click();
    await expect(page.getByRole('status')).toContainText('Added Carefree to favourites');
    // The same row's heart is pressed at once, here and on the album page, before any reload.
    await expect(row.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goto('/library?section=albums&lang=en&theme=dark');
    await page
      .getByRole('link', { name: /Royalty Free/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Royalty Free' })).toBeVisible();
    const albumRow = page.getByRole('listitem').filter({ hasText: 'Carefree' });
    await expect(albumRow.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const other = page.getByRole('listitem').filter({ hasText: 'Sneaky Snitch' });
    await other.getByRole('button', { name: 'Add to favourites' }).click();
    // Pressed the moment it is tapped: the album rows carry the cache's favourite by id.
    await expect(other.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 500 },
    );
    await expect
      .poll(
        async () =>
          (await serverState()).tracks.find((t) => t.Name === 'Sneaky Snitch')?.UserData.IsFavorite,
      )
      .toBe(true);
    await other.getByRole('button', { name: 'Remove from favourites' }).click();
    await expect(other.getByRole('button', { name: 'Add to favourites' })).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 500 },
    );
    await openTracks(page);
    await expect
      .poll(
        async () =>
          (await serverState()).tracks.find((t) => t.Name === 'Carefree')?.UserData.IsFavorite,
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Carefree' })
        .getByRole('button', { name: 'Remove from favourites' }),
    ).toBeVisible();
    await page.goto('/?lang=en&theme=dark');
    await expect(
      page.getByRole('region', { name: 'My songs' }).getByRole('button', { name: 'Play Carefree' }),
    ).toBeVisible();
  });

  test('makes a playlist, renames it, adds songs, reorders them with the server agreeing, keeps it private, deletes it', async ({
    page,
  }) => {
    await signIn(page);
    await openTracks(page);
    const name = `e2e ${Date.now()}`;
    await page.getByRole('button', { name: 'More options for Sneaky Snitch' }).click();
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'New playlist' }).click();
    await page.getByLabel('Playlist name').fill(name);
    await page.getByRole('button', { name: 'Create playlist' }).click();
    await expect(page.getByRole('status')).toContainText(`Created ${name}`);
    await expect
      .poll(async () => (await serverState()).playlists.some((p) => p.Name === name))
      .toBe(true);

    for (const title of ['Monkeys Spinning Monkeys', 'Carefree']) {
      await page.getByRole('button', { name: `More options for ${title}` }).click();
      await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: new RegExp(name) })
        .click();
      await expect(page.getByRole('status')).toContainText(`Added to ${name}`);
    }

    await page.getByRole('radio', { name: 'Playlists' }).click();
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const rowTitles = async () =>
      (
        await page
          .getByRole('list', { name: 'Songs' })
          .getByRole('button', { name: /^Play / })
          .allInnerTexts()
      ).map((t) => t.split('\n')[0] ?? '');
    await expect.poll(rowTitles).toEqual(['Sneaky Snitch', 'Monkeys Spinning Monkeys', 'Carefree']);
    const playlistId = (await serverState()).playlists.find((p) => p.Name === name)?.Id ?? '';

    // Reorder from the keyboard menu. Each move is read back from the server before the toast;
    // "up to the top" and "down by one" are the two a 10.10 server cannot do in one call.
    const moveFromMenu = async (title: string, item: 'Move up' | 'Move down') => {
      await page.getByRole('button', { name: `More options for ${title}` }).click();
      await page.getByRole('menuitem', { name: item }).click();
    };
    await moveFromMenu('Carefree', 'Move up');
    await expect(page.getByRole('status')).toContainText('Moved Carefree to position 2');
    await expect.poll(rowTitles).toEqual(['Sneaky Snitch', 'Carefree', 'Monkeys Spinning Monkeys']);
    await expect
      .poll(() => playlistOrder(playlistId))
      .toEqual(['Sneaky Snitch', 'Carefree', 'Monkeys Spinning Monkeys']);
    await moveFromMenu('Carefree', 'Move up');
    await expect(page.getByRole('status')).toContainText('Moved Carefree to position 1');
    await expect
      .poll(() => playlistOrder(playlistId))
      .toEqual(['Carefree', 'Sneaky Snitch', 'Monkeys Spinning Monkeys']);
    await moveFromMenu('Carefree', 'Move down');
    await expect(page.getByRole('status')).toContainText('Moved Carefree to position 2');
    await expect
      .poll(() => playlistOrder(playlistId))
      .toEqual(['Sneaky Snitch', 'Carefree', 'Monkeys Spinning Monkeys']);
    // Undo moves it back, and the server agrees.
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(() => playlistOrder(playlistId))
      .toEqual(['Carefree', 'Sneaky Snitch', 'Monkeys Spinning Monkeys']);
    // After a reload the page shows the server's order.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 15_000 });
    await expect.poll(rowTitles).toEqual(['Carefree', 'Sneaky Snitch', 'Monkeys Spinning Monkeys']);

    // A second user on the same server does not see this playlist (F86).
    const admin = await serverState();
    const otherName = `e2e-user-${Date.now()}`;
    const other = await api<{ Id: string }>(
      '/Users/New',
      { method: 'POST', body: JSON.stringify({ Name: otherName, Password: 'e2e-password' }) },
      admin.token,
    );
    try {
      const otherAuth = await authenticate(otherName, 'e2e-password', 'pw-e2e-other');
      const theirs = await api<{ Items: { Name: string }[] }>(
        `/Items?userId=${otherAuth.User.Id}&IncludeItemTypes=Playlist&Recursive=true`,
        {},
        otherAuth.AccessToken,
        'pw-e2e-other',
      );
      expect(theirs.Items.map((p) => p.Name)).not.toContain(name);
      expect((await serverState()).playlists.map((p) => p.Name)).toContain(name);
    } finally {
      // Each sign-in on the e2e device replaces the previous token, so delete with a fresh one.
      await api(`/Users/${other.Id}`, { method: 'DELETE' }, (await serverState()).token);
    }

    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Playlist name').fill(`${name} renamed`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `${name} renamed` })).toBeVisible();
    await expect
      .poll(async () => (await serverState()).playlists.some((p) => p.Name === `${name} renamed`))
      .toBe(true);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete playlist' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete playlist' }).click();
    await expect
      .poll(async () => (await serverState()).playlists.some((p) => p.Name.startsWith('e2e ')))
      .toBe(false);
  });

  test("on a phone the last song's menu opens above its button with every item inside the page, and the current row's glyph follows the bar", async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTracks(page);
    const main = page.getByRole('main');
    const mainBox = (await main.boundingBox()) ?? { y: 0, height: 0 };
    const lastRowMenu = page.getByRole('button', { name: 'More options for Sneaky Snitch' });
    await lastRowMenu.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-placement', 'above');
    const items = menu.getByRole('menuitem');
    expect(await items.count()).toBe(6);
    const trigger = (await lastRowMenu.boundingBox()) ?? { y: 0, height: 0 };
    for (let i = 0; i < 6; i++) {
      const box = (await items.nth(i).boundingBox()) ?? { y: -1, height: 0 };
      expect(box.y, `item ${i} inside the main area`).toBeGreaterThanOrEqual(mainBox.y);
      expect(box.y + box.height, `item ${i} above the Ask bar`).toBeLessThanOrEqual(
        mainBox.y + mainBox.height + 1,
      );
      expect(box.y + box.height, `item ${i} above its trigger`).toBeLessThanOrEqual(trigger.y + 1);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // The first row, with the whole list below it, still opens downward.
    await page.getByRole('button', { name: 'More options for Carefree' }).click();
    await expect(page.getByRole('menu')).toHaveAttribute('data-placement', 'below');
    await page.keyboard.press('Escape');

    // The current row's glyph: pause while playing, play while paused, the same as the bar's button.
    const pausePath = 'M7 5h3v14H7Zm7 0h3v14h-3Z';
    const playPath = 'M7 5v14l11-7Z';
    const rowGlyph = () =>
      page
        .locator('[data-playing] [aria-hidden] svg path, [data-playing] span[aria-hidden] path')
        .first()
        .getAttribute('d');
    await page.getByRole('button', { name: 'Play Carefree' }).click();
    const bar = page.getByRole('contentinfo');
    await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Pause Carefree' })).toBeVisible();
    expect(await rowGlyph()).toBe(pausePath);
    await bar.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play Carefree' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(await rowGlyph()).toBe(playPath);
  });

  test('the bar fits a tablet, now playing fits a desktop and a phone, and the Ask bar answers from the cache', async ({
    page,
  }) => {
    await signIn(page);
    await openTracks(page);
    await page.getByRole('button', { name: 'Play Sneaky Snitch' }).click();
    const bar = page.getByRole('contentinfo');
    await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
    await bar.getByRole('button', { name: 'Pause' }).click();

    // 820 px: the scrubber has room and the heart and queue sit on one line.
    await page.setViewportSize({ width: 820, height: 1180 });
    const slider = bar.getByRole('slider', { name: 'Position' });
    expect(((await slider.boundingBox()) ?? { width: 0 }).width).toBeGreaterThan(120);
    const heart = await bar.getByRole('button', { name: /favourites/ }).boundingBox();
    const queue = await bar.getByRole('link', { name: 'Queue' }).boundingBox();
    expect(Math.abs((heart?.y ?? 0) - (queue?.y ?? 99))).toBeLessThan(4);
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // Tablets in simple mode (the default): the five transport buttons share one row and the bar
    // is one height from 768 to 900.
    const transportNames = [/Shuffle/, 'Previous', /^(Play|Pause)$/, 'Next', /Repeat/] as const;
    let barHeight: number | undefined;
    for (const width of [768, 800, 820, 860, 900]) {
      await page.setViewportSize({ width, height: 1024 });
      await page.goto('/library?section=tracks&lang=en&theme=dark&mode=simple');
      await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
      const tops: number[] = [];
      for (const name of transportNames) {
        const box = await bar.getByRole('button', { name }).boundingBox();
        expect(box, `${width}: transport button ${String(name)}`).not.toBeNull();
        tops.push(Math.round(box?.y ?? 0));
      }
      expect(new Set(tops).size, `${width} simple: transport rows ${tops.join(',')}`).toBe(1);
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const height = Math.round((await bar.boundingBox())?.height ?? 0);
      barHeight ??= height;
      expect(height, `${width} simple: bar height`).toBe(barHeight);
    }

    // 1024 to 1366 in simple mode (the default, 1.25×): the scrubber keeps at least 160 px, the
    // transport sits clear of the title, nothing overflows; the times and the volume come at 1280.
    const title = bar.getByRole('link', { name: 'Open now playing' });
    const remaining = bar.getByText(/^-\d+:\d\d$/);
    for (const [width, mode] of [
      [1024, 'simple'],
      [1180, 'simple'],
      [1280, 'simple'],
      [1366, 'simple'],
      [1024, 'advanced'],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/library?section=tracks&lang=en&theme=dark&mode=${mode}`);
      await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
      const sliderBox = await slider.boundingBox();
      expect(sliderBox?.width ?? 0, `${mode} ${width}: scrubber width`).toBeGreaterThanOrEqual(160);
      const titleBox = await title.boundingBox();
      const previous = await bar.getByRole('button', { name: 'Previous' }).boundingBox();
      expect(
        previous?.x ?? 0,
        `${mode} ${width}: transport clear of the title`,
      ).toBeGreaterThanOrEqual((titleBox?.x ?? 0) + (titleBox?.width ?? 0));
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const heartBox = await bar.getByRole('button', { name: /favourites/ }).boundingBox();
      expect(heartBox?.x ?? 0, `${mode} ${width}: heart after the scrubber`).toBeGreaterThanOrEqual(
        (sliderBox?.x ?? 0) + (sliderBox?.width ?? 0),
      );
      if (mode === 'simple' && width < 1280) {
        await expect(remaining).toBeHidden();
        await expect(bar.getByRole('slider', { name: 'Volume' })).toBeHidden();
      } else {
        await expect(remaining).toBeVisible();
        await expect(bar.getByRole('slider', { name: 'Volume' })).toBeVisible();
      }
    }

    // 1280 x 800: now playing sits above the fold in both modes, and the page draws no second transport.
    for (const mode of ['simple', 'advanced']) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/now-playing?lang=en&theme=dark&mode=${mode}`);
      const actions = page.getByTestId('now-playing-actions');
      await expect(actions).toBeVisible();
      const main = page.getByRole('main');
      expect(await main.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      const box = await actions.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(800);
      await expect(page.getByTestId('now-playing-transport')).toBeHidden();
      await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
      const artBox = await page.getByTestId('now-playing-art').boundingBox();
      expect(artBox?.height ?? 999).toBeLessThanOrEqual(800 * 0.4 + 2);

      // 390 x 844: the lyrics, queue and cast row is above the fold without scrolling. Polled,
      // because the bar leaves this route a frame after the viewport crosses the phone breakpoint.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(actions).toBeVisible();
      await expect
        .poll(
          async () => {
            const mainBox = await main.boundingBox();
            const phoneBox = await actions.boundingBox();
            return (
              (phoneBox?.y ?? 0) +
              (phoneBox?.height ?? 0) -
              ((mainBox?.y ?? 0) + (mainBox?.height ?? 0))
            );
          },
          { message: `${mode} phone: action row below the main area` },
        )
        .toBeLessThanOrEqual(1);
      await expect
        .poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight), {
          message: `${mode} phone overflow`,
        })
        .toBeLessThanOrEqual(1);
    }

    // A 25 px root (a reader's zoom) at 390: the transport wraps and the sync line wraps; no page
    // scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/now-playing?mode=simple', '/library?section=tracks&mode=advanced']) {
      await page.goto(`${route}&lang=en&theme=dark`);
      await page.addStyleTag({ content: 'html { font-size: 25px !important; }' });
      await expect(page.getByRole('main')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
      expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
        true,
      );
    }

    // The label on a real placeholder and on a real genre card renders in the chart ink, read from
    // pixels, in both themes.
    const ink = hexToRgb(chartInk);
    for (const theme of ['dark', 'light'] as const) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/now-playing?lang=en&theme=${theme}&mode=simple`);
      const artLabel = page
        .getByTestId('now-playing-art')
        .getByTestId('placeholder-art')
        .locator('span');
      await expect(artLabel).toBeVisible();
      const art = inkOnSwatch(await renderedPixels(page, artLabel));
      expect(art.inked, `${theme} placeholder label drawn`).toBeGreaterThan(20);
      expect(art.ratio, `${theme} placeholder label contrast`).toBeGreaterThanOrEqual(4.5);
      expect(channelDistance(art.ink, ink), `${theme} placeholder ink`).toBeLessThan(24);
      // Genres are an advanced-mode section.
      await page.goto(`/library?section=genres&lang=en&theme=${theme}&mode=advanced`);
      const genre = page
        .getByRole('main')
        .getByRole('link')
        .filter({ hasText: /songs?$/ })
        .first();
      await expect(genre).toBeVisible({ timeout: 15_000 });
      const genreLabel = genre.locator('span span').first();
      const card = inkOnSwatch(await renderedPixels(page, genreLabel));
      expect(card.inked, `${theme} genre label drawn`).toBeGreaterThan(20);
      expect(card.ratio, `${theme} genre label contrast`).toBeGreaterThanOrEqual(4.5);
      expect(channelDistance(card.ink, ink), `${theme} genre ink`).toBeLessThan(24);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?lang=en&theme=dark');
    const ask = page.getByRole('combobox', { name: 'Ask for anything' });
    await ask.fill('ગ');
    await expect(page.getByText('Nothing in your library matches yet')).toBeVisible();
    await ask.fill('sneaky');
    const option = page.getByRole('option').filter({ hasText: 'Sneaky Snitch' });
    await expect(option).toBeVisible();
    await option.click();
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(
      'Sneaky Snitch',
    );
    await bar.getByRole('button', { name: 'Pause' }).click();
    await ask.click();
    await expect(page.getByRole('option', { name: 'sneaky' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/settings?lang=en&theme=dark');
    await expect(page.getByText(`Signed in as ${userName}`)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign in to your server' }),
    ).toBeVisible();
    // Sign-out removed this user's library database from the browser.
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases())
          .map((d) => d.name ?? '')
          .filter((n) => n.startsWith('renaissance-library')),
      ),
    ).toEqual([]);
  });

  test('a browser that blocks IndexedDB (site data blocked in a private window) still signs in and loads the library for the session', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException('Access is denied', 'SecurityError');
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await signIn(page);
      // In-app navigation only: without storage the session lasts this page load.
      await page.getByRole('complementary').getByRole('link', { name: 'Library' }).click();
      await page.getByRole('radio', { name: 'Songs' }).click();
      await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Play Carefree' })).toBeVisible();
      await page.getByRole('button', { name: 'Play Carefree' }).click();
      await expect(
        page.getByRole('contentinfo').getByRole('button', { name: 'Pause' }),
      ).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('contentinfo').getByRole('button', { name: 'Pause' }).click();
      await page.getByRole('complementary').getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByText('storage is blocked')).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
