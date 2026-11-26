import { afterEach, describe, expect, it, vi } from 'vitest';

import { debug, swallow } from './log';

describe('debug log', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says nothing unless the renaissance.debug flag is set in this browser (prod AH)', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    debug('cache write failed', new Error('full'));
    expect(spy).not.toHaveBeenCalled();
    localStorage.setItem('renaissance.debug', '1');
    debug('cache write failed', new Error('full'));
    expect(spy).toHaveBeenCalledWith('[renaissance] cache write failed', expect.any(Error));
    await Promise.reject(new Error('later')).catch(swallow('push fetch failed'));
    expect(spy).toHaveBeenLastCalledWith('[renaissance] push fetch failed', expect.any(Error));
    localStorage.removeItem('renaissance.debug');
  });
});
