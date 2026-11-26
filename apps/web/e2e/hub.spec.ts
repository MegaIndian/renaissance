import { expect, test } from '@playwright/test';

/**
 * The browser against the real hub (design O): Undo on an Add row and Cancel on the Requests tab
 * are DELETE requests, which a browser preflights. The hub must answer the preflight with DELETE
 * allowed, or both buttons die in the console while the hub never hears them; the committed
 * screenshots mock the hub and could not catch that. The hub here is `apps/hub/scripts/e2e-hub.mjs`:
 * the real server, dry-run pipeline, stand-ins for everything outside.
 */
test('Add, Undo and Cancel reach the hub from a real page, and the title stays visible at 390 px', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?hubToken=e2e-token&theme=dark');
  const box = page.getByRole('searchbox', { name: 'Ask for anything' });
  await box.fill('fireman');
  const rows = page.getByRole('list').filter({ hasText: 'Lil Wayne' });
  await expect(rows.getByText('Fireman').first()).toBeVisible();
  // One primary Add on the panel (DESIGN.md rule 1): the first row's; the rest are secondary.
  const adds = page.getByRole('button', { name: 'Add', exact: true });
  await expect(adds).toHaveCount(2);
  const tones = await adds.evaluateAll((els) =>
    els.map((el) => el.className.includes('bg-primary')),
  );
  expect(tones).toEqual([true, false]);
  await adds.first().click();
  await expect(page.getByText('Requested. Progress is in Requests')).toBeVisible();
  // The outcome sits on its own line: the song's title and the Undo are both still on screen.
  const row = rows.getByRole('listitem').filter({ hasText: 'Lil Wayne' }).first();
  await expect(row.getByText('Fireman')).toBeVisible();
  const undo = row.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeVisible();
  const box1 = await undo.boundingBox();
  expect(box1!.x + box1!.width).toBeLessThanOrEqual(390);
  // Undo is a real DELETE /requests/:id from the browser.
  const cancelled = page.waitForResponse(
    (res) => res.request().method() === 'DELETE' && res.url().includes('/requests/'),
  );
  await undo.click();
  expect((await cancelled).status()).toBe(200);
  await expect(row.getByText('Undone')).toBeVisible();

  // Add again, then cancel from the Requests tab: the same route, from another screen.
  await box.fill('');
  await box.fill('fireman');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByText('Requested. Progress is in Requests')).toBeVisible();
  await page.goto('/requests?theme=dark');
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  await expect(cancelButton).toHaveCount(1);
  const second = page.waitForResponse(
    (res) => res.request().method() === 'DELETE' && res.url().includes('/requests/'),
  );
  await cancelButton.click();
  expect((await second).status()).toBe(200);
  await expect(page.getByText('Cancelled', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  expect(consoleErrors.filter((e) => /CORS|Access-Control|Failed to fetch/i.test(e))).toEqual([]);
});
