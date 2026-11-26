import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

/**
 * The one search box (F61) in a real browser against the real hub (`apps/hub/scripts/e2e-hub.mjs`:
 * the server with stand-ins for MusicBrainz, Deezer, slskd, Lidarr and Navidrome). Jellyfin is a
 * stand-in inside the page: it signs the user in with the token the e2e hub accepts and serves an
 * empty library, so every song typed comes from the catalogue.
 */
const JELLYFIN = 'http://jellyfin.e2e';

async function jellyfin(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const reply = (body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: JSON.stringify(body),
    });
  if (method === 'OPTIONS')
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      },
    });
  if (url.pathname === '/System/Info/Public')
    return reply({ Version: '10.10.7', Id: 'srv-e2e', ServerName: 'E2E' });
  if (url.pathname === '/Users/AuthenticateByName')
    return reply({ User: { Id: 'u-e2e', Name: 'Sahil' }, AccessToken: 'e2e-token' });
  if (url.pathname === '/QuickConnect/Enabled') return reply(false);
  if (url.pathname.endsWith('/Items/Latest')) return reply([]);
  if (method !== 'GET') return route.fulfill({ status: 204 });
  return reply({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
}

async function signIn(page: Page): Promise<void> {
  await page.route(`${JELLYFIN}/**`, jellyfin);
  // Deezer's art and previews are decoration: answer them with nothing so no request leaves.
  await page.route('https://cdn.e2e/**', (route) => route.fulfill({ status: 404 }));
  await page.goto('/sign-in?lang=en');
  await page.getByRole('textbox', { name: 'Server address' }).fill(JELLYFIN);
  await page.getByRole('textbox', { name: 'User name' }).fill('sahil');
  await page.getByLabel('Password').fill('pw');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

// One hub for the file, and a song requested stays requested: in order, one at a time.
test.describe.configure({ mode: 'serial' });

test('Enter opens the search page with the full catalogue search and one primary Add', async ({
  page,
}) => {
  await signIn(page);
  const box = page.getByRole('combobox', { name: 'Ask for anything' }).first();
  await box.fill('fireman lil wayne');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=fireman/);
  const section = page.getByRole('main').getByRole('region', { name: 'Add from the catalogue' });
  const add = section.getByRole('button', { name: 'Add Fireman by Lil Wayne' });
  await expect(add).toBeVisible();
  // The one blue on the screen (DESIGN.md rule 1).
  await expect(section.locator('button.bg-primary')).toHaveCount(1);
  await expect(add).toHaveClass(/bg-primary/);
});

test('type a song, tap it, and watch it arrive: on its way, then Ready', async ({ page }) => {
  await signIn(page);
  const box = page.getByRole('combobox', { name: 'Ask for anything' }).first();
  await box.fill('fireman');
  const add = page.getByRole('option', { name: 'Add Fireman by Lil Wayne' });
  await expect(add).toBeVisible();
  await expect(page.getByText('Add from the catalogue').first()).toBeVisible();
  await expect(page.getByRole('option', { name: 'Add Fireman by Elliphant' })).toBeVisible();
  await add.click();
  // The row says it is on its way, and the toast says so with an Undo.
  await expect(page.getByRole('option', { name: /Fireman.*On its way/ })).toBeVisible();
  await expect(page.getByRole('status').getByText('Fireman is on its way')).toBeVisible();
  await expect(page.getByRole('status').getByRole('button', { name: 'Undo' })).toBeVisible();
  // The stream carries the pipeline's steps, then Ready (two transfer polls, the import, the scans).
  await expect(page.getByRole('option', { name: /Fireman.*Ready/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('status').getByText('Fireman is ready')).toBeVisible();
});

test('a song already on the server is added at once, with nothing fetched', async ({ page }) => {
  await signIn(page);
  const box = page.getByRole('combobox', { name: 'Ask for anything' }).first();
  await box.fill('carefree');
  await page.getByRole('option', { name: 'Add Carefree by Kevin MacLeod' }).click();
  await expect(page.getByRole('option', { name: /Carefree.*In your library/ })).toBeVisible();
  await expect(
    page.getByRole('status').getByText('Carefree is already in your library'),
  ).toBeVisible();
});
