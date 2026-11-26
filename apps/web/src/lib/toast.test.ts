import { afterEach, describe, expect, it, vi } from 'vitest';

import { dismissToast, toast, toastStore } from './toast';

describe('toast', () => {
  afterEach(() => {
    vi.useRealTimers();
    dismissToast();
  });

  it('shows one message at a time, keeps an undo longer, and dismisses only its own id', () => {
    vi.useFakeTimers();
    toast('first');
    toast('second', { undo: () => undefined, tone: 'danger' });
    const current = toastStore.get();
    expect(current).toMatchObject({ message: 'second', tone: 'danger' });
    dismissToast((current?.id ?? 0) - 1);
    expect(toastStore.get()?.message).toBe('second');
    vi.advanceTimersByTime(4000);
    expect(toastStore.get()?.message).toBe('second');
    vi.advanceTimersByTime(4000);
    expect(toastStore.get()).toBeNull();
    dismissToast();
    expect(toastStore.get()).toBeNull();
  });
});
