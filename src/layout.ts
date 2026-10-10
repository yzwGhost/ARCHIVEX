export function layoutFiles(count: number): Array<{ x: number; z: number; delayMs: number }> {
  return Array.from({ length: count }, (_, index) => ({
    x: index * 76,
    z: 0,
    delayMs: -index * 370,
  }));
}
