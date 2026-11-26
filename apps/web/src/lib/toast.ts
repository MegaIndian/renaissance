/**
 * "Every action shows what it did and has an undo" (DESIGN.md rule 10): one quiet toast at a time,
 * with an optional undo, announced to screen readers through the region that renders it.
 */
import { createStore } from '@renaissance/core';

export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
  tone: 'info' | 'danger';
}

export const toastStore = createStore<Toast | null>(null);

let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(
  message: string,
  options: { undo?: () => void; tone?: 'info' | 'danger'; durationMs?: number } = {},
): void {
  if (timer) clearTimeout(timer);
  const id = ++counter;
  toastStore.set({
    id,
    message,
    tone: options.tone ?? 'info',
    ...(options.undo ? { undo: options.undo } : {}),
  });
  timer = setTimeout(() => dismissToast(id), options.durationMs ?? (options.undo ? 8000 : 4000));
}

export function dismissToast(id?: number): void {
  const current = toastStore.get();
  if (!current || (id !== undefined && current.id !== id)) return;
  toastStore.set(null);
}
