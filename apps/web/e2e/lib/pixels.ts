import type { Locator, Page } from '@playwright/test';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered pixels inside an element's box, read from a screenshot (not from classes or
 * computed styles): the PNG is decoded in the page through a canvas, which a `data:` image does not
 * taint. One entry per CSS pixel.
 */
export async function renderedPixels(page: Page, locator: Locator): Promise<Rgb[]> {
  const box = await locator.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return [];
  const png = await page.screenshot({
    clip: {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    },
    scale: 'css',
  });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return [];
    context.drawImage(image, 0, 0);
    const { data: raw } = context.getImageData(0, 0, canvas.width, canvas.height);
    const out: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < raw.length; i += 4) {
      out.push({ r: raw[i] ?? 0, g: raw[i + 1] ?? 0, b: raw[i + 2] ?? 0 });
    }
    return out;
  }, png.toString('base64'));
}

function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * What a label on a swatch looks like once drawn: the most frequent colour is the swatch, the pixel
 * furthest from it in contrast is the ink (a fully covered glyph pixel; anti-aliased edges sit
 * between the two and never read as further away than the ink itself).
 */
export function inkOnSwatch(pixels: Rgb[]): {
  swatch: Rgb;
  ink: Rgb;
  ratio: number;
  inked: number;
} {
  const counts = new Map<string, { color: Rgb; n: number }>();
  for (const p of pixels) {
    const key = `${p.r},${p.g},${p.b}`;
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { color: p, n: 1 });
  }
  const swatch = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.color ?? { r: 0, g: 0, b: 0 };
  let ink = swatch;
  let ratio = 1;
  let inked = 0;
  for (const { color, n } of counts.values()) {
    const c = contrast(color, swatch);
    if (c > 3) inked += n;
    if (c > ratio) {
      ratio = c;
      ink = color;
    }
  }
  return { swatch, ink, ratio, inked };
}

export function hexToRgb(hex: string): Rgb {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  return { r, g, b };
}

/** Largest per-channel distance between two colours. */
export function channelDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}
