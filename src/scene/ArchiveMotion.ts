export const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Retargets from the sampled pose, so interrupted transitions never reset. */
export class MotionValue {
  private from: number;
  private target: number;
  private start = 0;
  private duration = 0;
  constructor(initial: number) { this.from = initial; this.target = initial; }
  value(now: number) {
    if (!this.duration) return this.target;
    const progress = Math.min(1, Math.max(0, (now - this.start) / this.duration));
    return this.from + (this.target - this.from) * easeInOut(progress);
  }
  to(target: number, duration: number, now: number) {
    this.from = this.value(now); this.target = target; this.start = now; this.duration = Math.max(0, duration);
  }
}
