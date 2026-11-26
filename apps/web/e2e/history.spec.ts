import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The listening log (F47) against the demo Jellyfin: a skipped play and a completed one land in
 * History under Today, the filters split them, a tap plays a song again, the log survives a reload,
 * the Settings switch stops new plays from being kept, and Clear history empties it with an undo.
 * Needs RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD (docs/testing.md);
 * values are read, never printed. The device record the browser signs in with is deleted afterwards,
 * and the server's play counts are left alone.
 */
const url = process.env['RENAISSANCE_DEMO_URL'];
const userName = process.env['RENAISSANCE_DEMO_USER'];
const password = process.env['RENAISSANCE_DEMO_PASSWORD'];
const configured = !!(url && userName && password);

test.describe('listening history against the demo Jellyfin', () => {
  test.skip(
    !configured,
    'RENAISSANCE_DEMO_URL, RENAISSANCE_DEMO_USER and RENAISSANCE_DEMO_PASSWORD are not set; the demo server is on the home LAN, so CI skips this file.',
  );

  const devices = new Set<string>();

  async function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
    const auth = `MediaBrowser Client="Renaissance e2e", Device="Playwright", DeviceId="pw-e2e-history", Version="0.0.0"${token ? `, Token="${token}"` : ''}`;
    return fetch(`${url}${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
    });
  }

  async function adminToken(): Promise<string> {
    const response = await api('/Users/AuthenticateByName', {
      method: 'POST',
      body: JSON.stringify({ Username: userName, Pw: password }),
    });
    return ((await response.json()) as { AccessToken: string }).AccessToken;
  }

  test.afterEach(async () => {
    const token = await adminToken();
    for (const id of [...devices, 'pw-e2e-history']) {
      await api(`/Devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' }, token).catch(
        () => undefined,
      );
    }
    devices.clear();
  });

  async function signIn(page: Page): Promise<void> {
    // Play reports (F26) are answered here and never reach the server: the log does not depend on
    // them, and demo.spec.ts, which may run beside this file, measures the server's play counts.
    await page.route(`${url}/Sessions/Playing**`, (route) => route.fulfill({ status: 204 }));
    await page.goto('/sign-in?lang=en&theme=dark');
    await page.getByRole('textbox', { name: 'Server address' }).fill(url ?? '');
    await page.getByRole('textbox', { name: 'User name' }).fill(userName ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`, ${userName}`);
    const deviceId = await page.evaluate(() => localStorage.getItem('renaissance.deviceId'));
    if (deviceId) devices.add(deviceId);
  }

  /** Open a screen from the sidebar: an in-app navigation, so the page and its player stay. */
  async function go(page: Page, name: string): Promise<void> {
    await page.getByRole('complementary').getByRole('link', { name, exact: true }).click();
  }

  /** Play a song from the Songs list until the position passes `seconds`. */
  async function playFor(page: Page, title: string, seconds: number): Promise<void> {
    await go(page, 'Library');
    await page.getByRole('radio', { name: 'Songs' }).click();
    await expect(page.getByText('4 songs')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: `Play ${title}` }).click();
    const bar = page.getByRole('contentinfo');
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(title);
    const position = page.getByRole('slider', { name: 'Position' });
    await expect
      .poll(async () => Number(await position.inputValue()), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(seconds);
  }

  const rows = (page: Page) => page.getByRole('main').getByRole('button', { name: /^Play / });

  test('logs a skip and a full play, filters them, plays one again, and is switched off and cleared from Settings', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page);
    const bar = page.getByRole('contentinfo');
    const position = page.getByRole('slider', { name: 'Position' });

    // A skip: three seconds of Carefree, then Next.
    await playFor(page, 'Carefree', 3);
    await bar.getByRole('button', { name: 'Next' }).click();
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(
      'Fluffing a Duck',
    );
    // A completed play: a few seconds of Fluffing a Duck, then seek to the end so it ends by itself.
    await expect
      .poll(async () => Number(await position.inputValue()), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await position.focus();
    await page.keyboard.press('End');
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText(
      'Monkeys Spinning Monkeys',
      { timeout: 20_000 },
    );
    // Monkeys plays on for two seconds and is paused: still open, it is logged once it is replaced.
    await expect
      .poll(async () => Number(await position.inputValue()), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await bar.getByRole('button', { name: 'Pause' }).click();

    await go(page, 'History');
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByRole('button', { name: /^Play / })).toHaveCount(2, { timeout: 10_000 });
    await expect(today.getByText(/· Skipped ·/)).toHaveCount(1);
    await expect(today.getByText(/· Completed ·/)).toHaveCount(1);
    // Newest first.
    await expect(today.getByRole('button', { name: /^Play / }).first()).toHaveAccessibleName(
      'Play Fluffing a Duck',
    );

    // The filters.
    await page.getByRole('radio', { name: 'Skipped' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(today.getByRole('button', { name: 'Play Carefree' })).toBeVisible();
    await page.getByRole('radio', { name: 'Completed' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(today.getByRole('button', { name: 'Play Fluffing a Duck' })).toBeVisible();
    await page.getByRole('radio', { name: 'All' }).click();
    await expect(rows(page)).toHaveCount(2);

    // Play again from History (Monkeys, replaced after two seconds, is a skip), then reload mid-song:
    // the log is on the device, and the play the reload cut short is kept too, as neither a skip
    // nor completed.
    await today.getByRole('button', { name: 'Play Carefree' }).click();
    await expect(bar.getByRole('link', { name: 'Open now playing' })).toContainText('Carefree');
    await expect
      .poll(async () => Number(await position.inputValue()), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Today' })).toBeVisible({ timeout: 15_000 });
    await expect(rows(page)).toHaveCount(4);
    await page.getByRole('radio', { name: 'Skipped' }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('radio', { name: 'Completed' }).click();
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('radio', { name: 'All' }).click();

    // Switched off in Settings, a new play is not kept.
    await go(page, 'Settings');
    const section = page.getByRole('region', { name: 'Listening history' });
    await expect(section.getByText('4 plays')).toBeVisible();
    const keep = section.getByRole('checkbox', { name: /Keep a listening history on this device/ });
    await expect(keep).toBeChecked();
    await keep.uncheck();
    // Sneaky Snitch is the last song by name, so Next ends the queue.
    await playFor(page, 'Sneaky Snitch', 3);
    await bar.getByRole('button', { name: 'Next' }).click();
    await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
    await go(page, 'History');
    await expect(page.getByRole('heading', { name: 'History is off' })).toBeVisible();
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Play Sneaky Snitch' })).toHaveCount(0);

    // Back on; Clear history, Undo, Clear again.
    await page.getByRole('link', { name: 'Open Settings' }).click();
    await page.getByRole('region', { name: 'Listening history' }).getByRole('checkbox').check();
    const clear = page.getByRole('button', { name: 'Clear history' });
    await clear.click();
    const toast = page.getByRole('status');
    await expect(toast).toContainText('Cleared 4 plays from history');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.getByRole('region', { name: 'Listening history' }).getByText('4 plays'),
    ).toBeVisible();
    await clear.click();
    await expect(clear).toBeDisabled();
    await go(page, 'History');
    await expect(page.getByRole('heading', { name: 'Nothing played yet' })).toBeVisible();
  });
});
