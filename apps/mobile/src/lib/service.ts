/**
 * RNTP's background service. Remote controls (lock screen, headphones) arrive in a later change; the
 * service exists now because RNTP needs one to keep the audio session alive in the background.
 */
export function PlaybackService(): Promise<void> {
  return Promise.resolve();
}
