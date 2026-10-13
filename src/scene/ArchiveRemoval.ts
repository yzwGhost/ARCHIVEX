export interface RemovalPose { forward: number; lift: number; rotation: number; done: boolean }

export function removalPose(elapsedMs: number, index: number, count: number): RemovalPose {
  const stagger = count <= 1 ? 0 : Math.min(400 / Math.max(1, count - 1), 70);
  const duration = 760;
  const progress = Math.max(0, Math.min(1, (elapsedMs - index * stagger) / duration));
  if (progress <= 0) return { forward: 0, lift: 0, rotation: 0, done: false };
  const eased = 1 - (1 - progress) ** 3;
  return { forward: eased * 7.5, lift: Math.sin(progress * Math.PI / 2) * 1.15, rotation: eased * .16,
    done: progress >= 1 };
}
