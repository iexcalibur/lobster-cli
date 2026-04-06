/**
 * Adds random jitter to timing delays to appear human-like.
 * Used when stealth mode is active.
 */

/**
 * Returns a jittered delay value in milliseconds.
 * @param baseMs - The nominal delay in milliseconds
 * @param jitterPct - The jitter range as a fraction (0.3 = ±30%)
 */
export function jitteredMs(baseMs: number, jitterPct = 0.3): number {
  const offset = baseMs * jitterPct * (2 * Math.random() - 1);
  return Math.max(0, Math.round(baseMs + offset));
}

/**
 * Sleeps for a jittered duration.
 * @param baseMs - The nominal delay in milliseconds
 * @param jitterPct - The jitter range as a fraction (0.3 = ±30%)
 */
export function jitteredDelay(baseMs: number, jitterPct = 0.3): Promise<void> {
  return new Promise((r) => setTimeout(r, jitteredMs(baseMs, jitterPct)));
}
