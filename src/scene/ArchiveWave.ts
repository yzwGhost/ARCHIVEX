/** A shared travelling wave keeps distant instances continuous with selectable files. */
export function archiveWave(x: number, z: number, now: number, detail: number): number {
  const phase = x * .95 + z * .25 - now * .00072;
  const height = .49 + Math.sin(phase) * .40 + Math.sin(phase * .55 + z * .13) * .09;
  const overview = 1 - Math.max(0, Math.min(1, detail));
  return height * overview * overview;
}
