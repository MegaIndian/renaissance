import { chartInk, colors } from '@renaissance/design';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { channelDistance, hexToRgb, inkOnSwatch, renderedPixels } from './lib/pixels';

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
  // Routes other than Home are lazy chunks: wait for the first control before counting.
  await locator.first().waitFor();
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
      await expectAskBarTarget(page, MIN[mode]);
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
      await expectAskBarTarget(page, MIN[mode]);
    });
  });
}

/**
 * The Ask bar is the one box on every screen: the input itself (what takes a tap) is at least the
 * rule's height, and a tap on the box's edge or its magnifier focuses it too.
 */
async function expectAskBarTarget(page: Page, min: number): Promise<void> {
  const input = page.getByRole('combobox');
  await expectAtLeast(input, min);
  const box = await input.evaluate((el) => {
    const r = (el.parentElement as HTMLElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.mouse.click(box.x + 8, box.y + 2);
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await input.blur();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2);
  await expect(input).toBeFocused();
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: keyboard focus draws the 2 px solid ring outline, offset 2 px, on every kind of control`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?theme=${theme}`);
    const controls = [
      page.getByRole('main').getByRole('link', { name: 'Sign in' }), // the primary LinkButton on the home card
      page.getByRole('complementary').getByRole('link', { name: 'Library' }),
      page.getByRole('radio', { name: 'English' }),
      page.getByRole('combobox'),
    ];
    // The first control is the one primary on the screen; the locator must not drift to another link.
    expect(await controls[0]?.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      rgb(colors[theme].primary),
    );
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
  // Nothing is focused on load (the desktop rests without a ring); ⌘K reaches the Ask bar and
  // Tab moves on to the first sign-in field.
  await expect(page.getByRole('combobox')).not.toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox')).toBeFocused();
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

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: a genre card label and a placeholder label render in the chart ink at 4.5:1 on every swatch (pixels, not classes)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?theme=${theme}`);
    // The same markup `LabelCard` and `PlaceholderArt` render, mounted over the page with the
    // built stylesheet: a `text-chart-ink` that the theme never mapped would inherit `foreground`
    // here exactly as it does on the real cards. Dark swatch 6 against a pale ink was 1.2:1.
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'ink-probe';
      host.style.cssText =
        'position:fixed;inset:0;z-index:9999;display:flex;flex-wrap:wrap;gap:16px;padding:16px;background:var(--background)';
      for (let i = 1; i <= 6; i++) {
        const card = document.createElement('span');
        card.className = 'flex aspect-video items-end rounded-sm p-3';
        card.style.cssText = `background: var(--chart-${i}); width: 240px`;
        card.dataset['probe'] = `card-${i}`;
        const label = document.createElement('span');
        label.className = 'truncate text-title font-semibold text-chart-ink';
        label.textContent = 'Orchestra';
        card.append(label);
        host.append(card);
        const art = document.createElement('div');
        art.className = 'relative shrink-0 overflow-hidden rounded-sm';
        art.style.cssText = `background: var(--chart-${i}); width: 160px; height: 160px`;
        art.dataset['probe'] = `art-${i}`;
        const caption = document.createElement('span');
        caption.className =
          'absolute bottom-1.5 left-2 right-2 truncate text-caption font-semibold text-chart-ink';
        caption.textContent = 'Monkeys Spinning Monkeys';
        art.append(caption);
        host.append(art);
      }
      document.body.append(host);
    });
    const ink = hexToRgb(chartInk);
    for (let i = 1; i <= 6; i++) {
      for (const kind of ['card', 'art'] as const) {
        const label = page.locator(`[data-probe="${kind}-${i}"] > span`);
        const drawn = inkOnSwatch(await renderedPixels(page, label));
        expect(drawn.inked, `${kind} ${i}: glyph pixels drawn`).toBeGreaterThan(20);
        expect(
          drawn.ratio,
          `${kind} ${i}: contrast of the ink on the swatch`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(channelDistance(drawn.ink, ink), `${kind} ${i}: ink is the chart ink`).toBeLessThan(
          24,
        );
      }
    }
  });
}
