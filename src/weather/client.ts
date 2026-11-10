import type { Settings } from '../settings';
import type { WeatherStats } from './solver';

export interface WeatherSnapshot {
  /** Liquid-water density in kg/m³, one value per grid cell. */
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
  private activeSeconds = 0;
  private measuredActiveSeconds = 0;
  private measuredSimulatedSeconds = 0;
  stats: WeatherStats = { seconds: 0, maxWind: 0, cloudMass: 0, cloudFraction: 0, maxTemperatureAnomaly: 0, achievedSpeed: 0 };

  constructor(settings: Settings, private readonly receive: (snapshot: WeatherSnapshot) => void) {
    this.worker.onmessage = (event: MessageEvent<WeatherSnapshot>) => {
      if (event.data.revision !== this.revision) return;
      this.busy = false;
      const elapsed=this.activeSeconds-this.measuredActiveSeconds;
      this.stats = { ...event.data.stats, achievedSpeed: elapsed>0 ? (event.data.stats.seconds-this.measuredSimulatedSeconds)/elapsed : 0 };
      this.measuredActiveSeconds=this.activeSeconds;
      this.measuredSimulatedSeconds=event.data.stats.seconds;
      this.receive({...event.data,stats:this.stats});
    };
    this.reset(settings);
  }

  reset(settings: Settings) {
    this.revision++;
    this.busy = true;
    this.accumulator = 0;
    this.activeSeconds=this.measuredActiveSeconds=this.measuredSimulatedSeconds=0;
    this.stats.achievedSpeed=0;
    this.worker.postMessage({ type: 'reset', settings: { ...settings }, revision: this.revision });
  }

  update(deltaSeconds: number, settings: Settings) {
    if (settings.paused || !settings.clouds || settings.pressure <= 0) {this.stats.achievedSpeed=0;return;}
    this.activeSeconds += deltaSeconds;
    this.accumulator += deltaSeconds;
    if (this.busy || this.accumulator < 0.12) return;
    this.busy = true;
    const dt = Math.min(this.accumulator, 0.3) * settings.timeScale;
    this.accumulator = 0;
    this.worker.postMessage({ type: 'step', dt, revision: this.revision });
  }

  dispose() { this.worker.terminate(); }
}
