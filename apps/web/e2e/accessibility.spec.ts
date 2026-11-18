import { colors } from '@renaissance/design';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** DESIGN.md rule 12: at least 24 × 24 px in advanced mode, 30 × 30 px in simple mode (1.25×). */
const MIN = { advanced: 24, simple: 30 } as const;

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function size(locator: Locator): Promise<{ width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, await locator.evaluate((el) => el.outerHTML.slice(0, 80))).not.toBeNull();
  return { width: box?.width ?? 0, height: box?.height ?? 0 };
}

async function expectAtLeast(locator: Locator, min: number): Promise<void> {
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const { width, height } = await size(locator.nth(i));
    expect(width, `${await locator.nth(i).innerText()} width`).toBeGreaterThanOrEqual(min);
    expect(height, `${await locator.nth(i).innerText()} height`).toBeGreaterThanOrEqual(min);
  }
}

async function focusOutline(page: Page, locator: Locator) {
  await locator.focus();
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      style: s.outlineStyle,
      width: s.outlineWidth,
      offset: s.outlineOffset,
      color: s.outlineColor,
      matches: el.matches(':focus-visible'),
    };
  });
}

for (const mode of ['simple', 'advanced'] as const) {
  test.describe(`${mode} mode`, () => {
    test(`phone: language segments, tabs and the avatar are at least ${MIN[mode]} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/?mode=${mode}&theme=dark`);
      await expectAtLeast(page.getByRole('radio'), MIN[mode]);
      await expectAtLeast(
        page.getByRole('navigation', { name: 'Navigation' }).getByRole('link'),
        MIN[mode],
      );
      await expectAtLeast(
        page.getByRole('banner').getByRole('link', { name: 'Sign in' }),
        MIN[mode],
      );
    });

    test(`desktop: sidebar items, the sign-in link and segments are at least ${MIN[mode]} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/library?mode=${mode}&theme=dark`);
      const sidebar = page.getByRole('complementary');
      await expectAtLeast(sidebar.getByRole('link'), MIN[mode]);
      await expectAtLeast(sidebar.getByRole('radio'), MIN[mode]);
      await expectAtLeast(page.getByRole('button', { name: 'Play' }), MIN[mode]);
    });
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: keyboard focus draws the 2 px solid ring outline, offset 2 px, on every kind of control`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?theme=${theme}`);
    const controls = [
      page.getByRole('link', { name: 'Sign in' }).first(), // the primary LinkButton on the home card
      page.getByRole('complementary').getByRole('link', { name: 'Library' }),
      page.getByRole('radio', { name: 'English' }),
      page.getByRole('searchbox'),
    ];
    for (const control of controls) {
      const outline = await focusOutline(page, control);
      // The Ask bar draws its outline on the box around the input (focus-within); read it there.
      const drawn =
        outline.style === 'solid'
          ? outline
          : await control.evaluate((el) => {
              const box = el.parentElement as HTMLElement;
              const s = getComputedStyle(box);
              return {
                style: s.outlineStyle,
                width: s.outlineWidth,
                offset: s.outlineOffset,
                color: s.outlineColor,
                matches: true,
              };
            });
      expect(drawn.style).toBe('solid');
      expect(drawn.width).toBe('2px');
      expect(drawn.offset).toBe('2px');
      expect(drawn.color).toBe(rgb(colors[theme].ring));
    }
  });
}

test('a mouse click does not draw the outline, keyboard focus does', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sign-in');
  const library = page.getByRole('complementary').getByRole('link', { name: 'Library' });
  await library.hover();
  await page.mouse.down();
  const clicked = await library.evaluate((el) => getComputedStyle(el).outlineStyle);
  await page.mouse.up();
  expect(clicked).not.toBe('solid');
  await page.goto('/sign-in');
  // The Ask bar takes focus on load (desktop); Tab moves to the first sign-in field.
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Tab');
  const server = page.getByRole('textbox', { name: 'Server address' });
  await expect(server).toBeFocused();
  expect(await server.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await server.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(await server.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(
    rgb(colors.dark.ring),
  );
});

test('an unknown URL keeps the shell and offers the way home, in Gujarati too', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nope?lang=gu');
  await expect(page.getByText('આ સરનામે કોઈ પેજ નથી')).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
  await page.getByRole('link', { name: 'હોમ પર જાઓ' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the favicon and theme colour are served', async ({ page, request }) => {
  const icon = await request.get('/favicon.svg');
  expect(icon.ok()).toBe(true);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  await page.goto('/');
  expect(await page.locator('meta[name="theme-color"]').count()).toBe(2);
});
