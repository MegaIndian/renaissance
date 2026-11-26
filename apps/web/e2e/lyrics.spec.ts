import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

/**
 * Lyrics (F39, F40) against the demo Jellyfin. The demo tracks are instrumental and the server may
 * have no lyrics files, so `/Audio/{id}/Lyrics` is answered here for two songs in Jellyfin's own
 * shape: Carefree synced (starts in ticks), Fluffing a Duck as plain lines. Every other song goes to
 * the real server, which answers 404, the "no lyrics" case. Needs the RENAISSANCE_DEMO_* variables
 * (docs/testing.md); skipped without them, as in CI.
 */
const url = process.env['RENAISSANCE_DEMO_URL'];
const userName = process.env['RENAISSANCE_DEMO_USER'];
const password = process.env['RENAISSANCE_DEMO_PASSWORD'];
const configured = !!(url && userName && password);

const SYNCED: [number, string][] = [
  [4, 'Window open, morning light'],
  [9.5, 'Coffee warm and the street is bright'],
  [15, 'Nowhere to be and nothing to chase'],
  [20.5, 'Just the sun on an easy face'],
  [26, ''],
  [30, 'Whistle along, the day is long'],
  [35.5, 'Every step a little song'],
  [41, 'Hands in pockets, kick a stone'],
  [46.5, 'Carefree, never alone'],
  [52, ''],
  [56, 'Down by the river the ducks parade'],
  [61.5, 'Into the shade, into the shade'],
  [67, 'Bicycle bells and a passing train'],
  [72.5, 'Here comes the tune again'],
  [78, ''],
  [82, 'Whistle along, the day is long'],
  [87.5, 'Every step a little song'],
  [93, 'Hands in pockets, kick a stone'],
  [98.5, 'Carefree, never alone'],
  [110, 'Evening falls and the lamps come on'],
  [115.5, 'Hum it soft till the light is gone'],
  [121, 'Tomorrow comes and we start anew'],
  [126.5, 'Carefree, me and you'],
];
const PLAIN = [
  'A duck in a puddle, a splash and a flap',
  'Feathers all fluffed from a mid-morning nap',
  '',
  'Waddle to the left, waddle to the right',
  'Quack at the clouds till they float out of sight',
];

test.describe('lyrics against the demo Jellyfin', () => {
  test.skip(
    !configured,
    'RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD are not set; the demo server is on the home LAN, so CI skips this file.',
  );
  test.describe.configure({ mode: 'serial' });

  const auth = (deviceId: string, token?: string) =>
    `MediaBrowser Client="Renaissance e2e", Device="Playwright", DeviceId="${deviceId}", Version="0.0.0"${token ? `, Token="${token}"` : ''}`;

  async function adminToken(): Promise<string> {
    const response = await fetch(`${url}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { Authorization: auth('pw-e2e-lyrics'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ Username: userName, Pw: password }),
    });
    if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
    return ((await response.json()) as { AccessToken: string }).AccessToken;
  }

  async function trackIds(): Promise<Record<string, string>> {
    const token = await adminToken();
    const response = await fetch(`${url}/Items?IncludeItemTypes=Audio&Recursive=true`, {
      headers: { Authorization: auth('pw-e2e-lyrics', token) },
    });
    const items = ((await response.json()) as { Items: { Id: string; Name: string }[] }).Items;
    return Object.fromEntries(items.map((i) => [i.Name, i.Id]));
  }

  async function deleteDevice(id: string, token: string): Promise<void> {
    await fetch(`${url}/Devices?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: auth('pw-e2e-lyrics', token) },
    }).catch(() => undefined);
  }

  const devices = new Set<string>();
  test.afterEach(async () => {
    if (!devices.size) return;
    const token = await adminToken();
    for (const id of devices) await deleteDevice(id, token);
    devices.clear();
  });
  test.afterAll(async () => {
    if (!configured) return;
    await deleteDevice('pw-e2e-lyrics', await adminToken());
  });

  /** Answer the lyrics endpoint for Carefree and Fluffing a Duck; pass the rest to the server. */
  async function stubLyrics(page: Page): Promise<string[]> {
    const ids = await trackIds();
    const asked: string[] = [];
    const json = (route: Route, body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    await page.route('**/Audio/*/Lyrics', (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2] ?? '';
      asked.push(id);
      if (id === ids['Carefree']) {
        return json(route, {
          Metadata: { IsSynced: true },
          Lyrics: SYNCED.map(([s, text]) => ({ Text: text, Start: s * 10_000_000 })),
        });
      }
      if (id === ids['Fluffing a Duck']) {
        return json(route, { Metadata: {}, Lyrics: PLAIN.map((text) => ({ Text: text })) });
      }
      return route.continue();
    });
    return asked;
  }

  async function signIn(page: Page, query = 'lang=en&theme=dark'): Promise<void> {
    await page.goto(`/sign-in?${query}`);
    await page.getByRole('textbox', { name: 'Server address' }).fill(url ?? '');
    await page.getByRole('textbox', { name: 'User name' }).fill(userName ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`, ${userName}`);
    const deviceId = await page.evaluate(() => localStorage.getItem('renaissance.deviceId'));
    if (deviceId) devices.add(deviceId);
  }

  async function playCarefree(page: Page, query: string): Promise<void> {
    await page.goto(`/library?section=tracks&${query}`);
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Play Carefree' }).click();
    await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Pause' })).toBeVisible({
      timeout: 15_000,
    });
  }

  const position = (page: Page) =>
    page
      .getByRole('slider', { name: 'Position' })
      .first()
      .inputValue()
      .then((v) => Number(v));

  /** Distance in px between the current line's centre and the middle of the scrolling `main`. */
  const offCentre = (page: Page) =>
    page.evaluate(() => {
      const line = document.querySelector('[data-testid="lyric-line"][aria-current="true"]');
      const main = document.querySelector('main');
      if (!line || !main) return Number.POSITIVE_INFINITY;
      const l = line.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      return Math.abs(l.top + l.height / 2 - (m.top + m.height / 2));
    });

  test('synced lyrics follow the song, a click seeks, scrolling pauses the follow, then plain text and none', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const asked = await stubLyrics(page);
    await signIn(page);
    await playCarefree(page, 'lang=en&theme=dark&mode=simple');

    // From the now-playing screen's Lyrics link.
    await page.getByRole('contentinfo').getByRole('link', { name: 'Open now playing' }).click();
    await page.getByRole('main').getByRole('link', { name: 'Lyrics' }).click();
    await expect(page).toHaveURL(/\/lyrics/);
    await expect(page).toHaveTitle('Lyrics · Renaissance');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Lyrics' })).toBeVisible();
    await expect(main.getByText('Carefree · Kevin MacLeod')).toBeVisible();
    const list = main.getByRole('list', { name: 'Lyrics' });
    const lines = list.getByTestId('lyric-line');
    await expect(lines).toHaveCount(SYNCED.length);
    expect(asked.length).toBeGreaterThan(0);

    // The first line lights up once the song reaches 0:04, and only one line is current.
    await expect(lines.nth(0)).toHaveAttribute('aria-current', 'true', { timeout: 15_000 });
    await expect(list.locator('[aria-current="true"]')).toHaveCount(1);

    // Clicking a line far down plays from its start and centres it.
    await lines.nth(15).click();
    await expect.poll(() => position(page)).toBeGreaterThanOrEqual(82);
    await expect(lines.nth(15)).toHaveAttribute('aria-current', 'true');
    await expect(lines.nth(15)).toHaveCSS('font-weight', '600');
    await expect(lines.nth(14)).not.toHaveAttribute('aria-current');
    await expect.poll(() => offCentre(page), { timeout: 5_000 }).toBeLessThan(40);

    // The listener scrolls: the follow stops and offers the way back; a few seconds later it
    // follows again by itself.
    await main.hover();
    await page.mouse.wheel(0, -2000);
    const back = main.getByRole('button', { name: 'Back to the current line' });
    await expect(back).toBeVisible();
    await expect(back).toBeHidden({ timeout: 8_000 });
    await expect.poll(() => offCentre(page), { timeout: 5_000 }).toBeLessThan(40);

    // Scroll away and press the button: back at once.
    await page.mouse.wheel(0, -2000);
    await back.click();
    await expect(back).toBeHidden();
    await expect.poll(() => offCentre(page), { timeout: 3_000 }).toBeLessThan(40);

    // The keyboard: one tab stop, arrows move, Enter seeks.
    await lines.nth(15).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(lines.nth(17)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => position(page)).toBeGreaterThanOrEqual(93);
    expect(await position(page)).toBeLessThan(98);
    await expect(lines.nth(17)).toHaveAttribute('aria-current', 'true');
    expect(await list.locator('button[tabindex="0"]').count()).toBe(1);

    // Next song: plain text, nothing highlighted, no line buttons.
    await page.getByRole('contentinfo').getByRole('button', { name: 'Next' }).click();
    await expect(main.getByText('Fluffing a Duck · Kevin MacLeod')).toBeVisible();
    await expect(
      main.getByText('These lyrics have no timings, so they do not follow the song.'),
    ).toBeVisible();
    await expect(main.getByText('Quack at the clouds till they float out of sight')).toBeVisible();
    await expect(main.getByTestId('lyric-verse')).toHaveCount(2);
    await expect(main.getByTestId('lyric-line')).toHaveCount(0);

    // And one the server has no lyrics for: its real 404.
    await page.getByRole('contentinfo').getByRole('button', { name: 'Next' }).click();
    await expect(main.getByText('Monkeys Spinning Monkeys · Kevin MacLeod')).toBeVisible();
    await expect(main.getByText('No lyrics for this song')).toBeVisible();
    await page.getByRole('contentinfo').getByRole('button', { name: 'Pause' }).click();
  });

  test('on a phone with reduced motion and in Gujarati: the jump is instant and the bar stays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubLyrics(page);
    await signIn(page, 'lang=en&theme=light');
    await playCarefree(page, 'lang=en&theme=light&mode=simple');
    await page.goto('/now-playing?lang=gu&theme=light');
    await page.getByRole('main').getByRole('link', { name: 'ગીતના શબ્દો' }).click();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'ગીતના શબ્દો' })).toBeVisible();
    // The player bar is on this screen on a phone too.
    await expect(page.getByRole('contentinfo')).toBeVisible();
    const lines = main.getByTestId('lyric-line');
    await expect(lines).toHaveCount(SYNCED.length);
    // A line is at least 30 px tall in simple mode (a 24 px target at the 1.25 root).
    const box = await lines.nth(3).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(30);
    // No sideways scroll, and Gujarati and English lines wrap inside the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );

    // Reduced motion: a seek far down is centred on the next frame, without a glide.
    await lines.nth(20).click();
    await expect(lines.nth(20)).toHaveAttribute('aria-current', 'true');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(await offCentre(page)).toBeLessThan(40);
    await page.getByRole('contentinfo').getByRole('button', { name: 'થોભાવો' }).click();
  });
});
