import type { Settings } from '../settings';
import type { WeatherStats } from './solver';

export interface WeatherSnapshot {
  data: Float32Array;
  stats: WeatherStats;
  dimensions: readonly [number, number, number];
  revision: number;
}

export class WeatherClient {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private revision = 0;
  private busy = true;
  private accumulator = 0;
  stats: WeatherStats = { seconds: 0, maxWind: 0, cloudMass: 0, cloudFraction: 0, maxTemperatureAnomaly: 0 };

  constructor(settings: Settings, private readonly receive: (snapshot: WeatherSnapshot) => void) {
    this.worker.onmessage = (event: MessageEvent<WeatherSnapshot>) => {
      if (event.data.revision !== this.revision) return;
      this.busy = false;
      this.stats = event.data.stats;
      this.receive(event.data);
    };
    this.reset(settings);
  }

  reset(settings: Settings) {
    this.revision++;
    this.busy = true;
    this.accumulator = 0;
    this.worker.postMessage({ type: 'reset', settings: { ...settings }, revision: this.revision });
  }

  update(deltaSeconds: number, settings: Settings) {
    if (settings.paused || !settings.clouds || settings.pressure <= 0) return;
    this.accumulator += deltaSeconds;
    if (this.busy || this.accumulator < 0.12) return;
    this.busy = true;
    const dt = Math.min(this.accumulator, 0.3) * settings.timeScale;
    this.accumulator = 0;
    this.worker.postMessage({ type: 'step', dt, revision: this.revision });
  }

  dispose() { this.worker.terminate(); }
}
