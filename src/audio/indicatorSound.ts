import { CONFIG } from '../config';

const CLICK_SECONDS = 0.04;

/**
 * The "tick-tock" of the indicator relay, synthesised with the Web Audio API (no sound files):
 * a short burst of filtered noise each time the lamps switch on ("tick") and off ("tock").
 */
export class IndicatorSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lampWasLit = false;

  constructor(private readonly volume: number = CONFIG.audio.indicatorVolume) {}

  /** Browsers keep sound muted until the user presses a key or clicks; call this from such an event. */
  unlock(): void {
    if (!this.context) {
      if (typeof AudioContext === 'undefined') return;
      this.context = new AudioContext();
      this.noise = createNoise(this.context, CLICK_SECONDS);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** Call every frame with whether any indicator lamp is lit. */
  update(lampLit: boolean): void {
    if (lampLit === this.lampWasLit) return;
    this.lampWasLit = lampLit;
    this.click(lampLit ? 3200 : 2300);
  }

  private click(frequency: number): void {
    const context = this.context;
    if (!context || !this.noise || context.state !== 'running') return;

    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 1.2;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + CLICK_SECONDS);

    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + CLICK_SECONDS);
  }
}

function createNoise(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
