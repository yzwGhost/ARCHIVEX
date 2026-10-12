export interface FilePosition {
  x: number;
  y: number;
  z: number;
  group: number;
}

export function layoutFiles(count: number): FilePosition[] {
  return Array.from({ length: count }, (_, index) => {
    const group = Math.floor(index / 8);
    const slot = index % 8;
    return {
      x: (slot - 3.5) * .48,
      y: 0,
      z: -group * 4.6,
      group,
    };
  });
}
