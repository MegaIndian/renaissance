import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The phase 1 exit test against a real Jellyfin (the demo container with the four Kevin MacLeod
 * tracks): sign in, browse, play, favourite, make a playlist, and check the server's play count rose.
 * Needs RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD in the environment;
 * without them the whole file is skipped with the reason (CI has no route to the NAS, see
 * docs/testing.md). Values are read, never printed.
 */
const url = process.env['RENAISSANCE_DEMO_URL'];
const userName = process.env['RENAISSANCE_DEMO_USER'];
const password = process.env['RENAISSANCE_DEMO_PASSWORD'];
const configured = !!(url && userName && password);

test.describe('against the demo Jellyfin', () => {
  test.skip(
    !configured,
    'RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD are not set; the demo server is on the home LAN, so CI skips this file.',
  );
  test.describe.configure({ mode: 'serial' });

  async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const auth = `MediaBrowser Client="Renaissance e2e", Device="Playwright", DeviceId="pw-e2e", Version="0.0.0"${token ? `, Token="${token}"` : ''}`;
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Server-side state, read with its own session so the browser's reports are what is measured. */
  async function serverState(): Promise<{
    token: string;
    userId: string;
    tracks: { Id: string; Name: string; UserData: { PlayCount: number; IsFavorite: boolean } }[];
    playlists: { Id: string; Name: string }[];
  }> {
    const auth = await api<{ AccessToken: string; User: { Id: string } }>(
      '/Users/AuthenticateByName',
      {
        method: 'POST',
        body: JSON.stringify({ Username: userName, Pw: password }),
      },
    );
    const token = auth.AccessToken;
    const userId = auth.User.Id;
    const items = await api<{ Items: never[] }>(
      `/Items?userId=${userId}&IncludeItemTypes=Audio&Recursive=true&SortBy=SortName`,
      {},
      token,
    );
    const lists = await api<{ Items: never[] }>(
      `/Items?userId=${userId}&IncludeItemTypes=Playlist&Recursive=true`,
      {},
      token,
    );
    return { token, userId, tracks: items.Items, playlists: lists.Items };
  }

  async function signIn(page: Page): Promise<void> {
    await page.goto('/sign-in?lang=en&theme=dark');
    await page.getByRole('textbox', { name: 'Server address' }).fill(url ?? '');
    await page.getByRole('textbox', { name: 'User name' }).fill(userName ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`, ${userName}`);
  }

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
  });

  test('signs in, browses the four tracks and the artist, plays one and the play count rises', async ({
    page,
  }) => {
    const before = await serverState();
    expect(before.tracks).toHaveLength(4);
    await signIn(page);

    // The library comes from the cache after the first sync; four songs, sorted by name.
    await page.goto('/library?section=tracks&lang=en&theme=dark');
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
    const titles = ['Carefree', 'Fluffing a Duck', 'Monkeys Spinning Monkeys', 'Sneaky Snitch'];
    for (const title of titles) {
      await expect(page.getByRole('button', { name: `Play ${title}` })).toBeVisible();
    }
    await page.getByRole('radio', { name: 'Artists' }).click();
    await page.getByRole('link', { name: 'Kevin MacLeod' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kevin MacLeod' })).toBeVisible();
    await expect(page.getByText('4 songs')).toBeVisible();

    // Play the shortest track from the artist page and let the browser report to the server.
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
      {
        timeout: 20_000,
      },
    );
    await bar.getByRole('button', { name: 'Pause' }).click();

    // The queue survives a reload (F22): the bar comes back with the same track, paused.
    const nowShowing = await bar.getByRole('link', { name: 'Open now playing' }).innerText();
    await page.reload();
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(
      nowShowing.split('\n')[0] ?? '',
      {
        timeout: 15_000,
      },
    );
    await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();

    const duck = before.tracks.find((t) => t.Name === 'Fluffing a Duck');
    await expect
      .poll(
        async () => (await serverState()).tracks.find((t) => t.Id === duck?.Id)?.UserData.PlayCount,
        {
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(duck?.UserData.PlayCount ?? 0);
  });

  test('favourites a song and the server agrees; the heart survives a reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/library?section=tracks&lang=en&theme=dark');
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
    const row = page.getByRole('listitem').filter({ hasText: 'Carefree' });
    await row.getByRole('button', { name: 'Add to favourites' }).click();
    await expect(page.getByRole('status')).toContainText('Added Carefree to favourites');
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

  test('makes a playlist from a song, renames it, adds a second song and sees it on the server', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/library?section=tracks&lang=en&theme=dark');
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
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

    await page.getByRole('button', { name: 'More options for Monkeys Spinning Monkeys' }).click();
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: new RegExp(name) })
      .click();
    await expect(page.getByRole('status')).toContainText(`Added to ${name}`);

    await page.getByRole('radio', { name: 'Playlists' }).click();
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play Sneaky Snitch' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play Monkeys Spinning Monkeys' })).toBeVisible();
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

  test('the Ask bar answers from the local cache and recent searches come back', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByText(/Last refreshed|Loading your library/)).toBeVisible({
      timeout: 15_000,
    });
    const ask = page.getByRole('combobox', { name: 'Ask for anything' });
    await ask.fill('sneaky');
    const option = page.getByRole('option').filter({ hasText: 'Sneaky Snitch' });
    await expect(option).toBeVisible();
    await option.click();
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Open now playing' }),
    ).toContainText('Sneaky Snitch');
    await page.getByRole('contentinfo').getByRole('button', { name: 'Pause' }).click();
    await ask.click();
    await expect(page.getByRole('option', { name: 'sneaky' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/settings?lang=en&theme=dark');
    await expect(page.getByText(`Signed in as ${userName}`)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign in to your server' }),
    ).toBeVisible();
  });
});
