import { expect, test } from '@playwright/test';

/**
 * Sign-in behaviour that needs a browser but no server: the request timeout, the https-first probe
 * for a scheme-less address with the http notice, and the Content-Security-Policy the page ships.
 */
test('a host that never answers fails within the timeout with the unreachable sentence', async ({
  page,
}) => {
  await page.route('**/Users/AuthenticateByName', () => new Promise(() => undefined));
  await page.goto('/sign-in?lang=en');
  await page.getByRole('textbox', { name: 'Server address' }).fill('http://10.255.255.1:8096');
  await page.getByRole('textbox', { name: 'User name' }).fill('mom');
  await page.getByLabel('Password').fill('pw');
  const started = Date.now();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('could not reach that server', {
    timeout: 12_000,
  });
  expect(Date.now() - started).toBeLessThan(12_000);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('a scheme-less address tries https first and, when only http answers, shows the notice before sending anything', async ({
  page,
}) => {
  const seen: string[] = [];
  await page.route('**/System/Info/Public', (route) => {
    seen.push(route.request().url());
    if (route.request().url().startsWith('https:')) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ Version: '10.10.7' }),
    });
  });
  await page.route('**/Users/AuthenticateByName', (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/sign-in?lang=en');
  const address = page.getByRole('textbox', { name: 'Server address' });
  await address.fill('music.example.com');
  await page.getByRole('textbox', { name: 'User name' }).fill('mom');
  await page.getByLabel('Password').fill('pw');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(address).toHaveValue('http://music.example.com');
  await expect(page.getByText(/travel over the network unencrypted/)).toBeVisible();
  expect(seen).toEqual([
    'https://music.example.com/System/Info/Public',
    'http://music.example.com/System/Info/Public',
  ]);
  // The password went nowhere; the next press sends it to the address now shown.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('user name or password is wrong');
  expect(seen.at(-1)).toBe('http://music.example.com/Users/AuthenticateByName');
});

test('the page ships a Content-Security-Policy that allows no inline script, and the app still renders under it', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto('/?lang=en');
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox')).toBeVisible();
  expect(violations).toEqual([]);
});
