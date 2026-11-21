import { createContext, useContext } from 'react';
import type { RefObject } from 'react';

/** The shell's scrolling `main`, so virtualised lists can measure against it. */
export const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useScrollContainer(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollContainerContext);
}
