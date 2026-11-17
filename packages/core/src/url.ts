/** Drops trailing slashes without a regex, so a string of many slashes costs one pass. */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* / */) end--;
  return url.slice(0, end);
}
