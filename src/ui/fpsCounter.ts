/** Frames per second averaged over a short window, so the number is readable rather than jumpy. */
export class FpsCounter {
  private frames = 0;
  private elapsed = 0;
  private current = 0;

  constructor(private readonly windowSeconds: number) {}

  get fps(): number {
    return this.current;
  }

  /** Call once per rendered frame with the real time since the previous frame. */
  tick(frameSeconds: number): void {
    this.frames += 1;
    this.elapsed += frameSeconds;
    if (this.elapsed >= this.windowSeconds) {
      this.current = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
    }
  }
}
