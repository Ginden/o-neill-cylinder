import type { Settings } from '../settings';
import type { WeatherStats } from './solver';
import type { CacheOptics } from '../render/cache';
import { weatherTransportKey } from './transport';
import type { PreparedWeatherSnapshot } from './transport';
export type { PreparedWeatherSnapshot as WeatherSnapshot } from './transport';

export class WeatherClient {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private revision = 0;
  private busy = true;
  private opticsRevision=0;
  private transportState='';
  private particleState='';
  private ready=false;
  private accumulator = 0;
  private activeSeconds = 0;
  private measuredActiveSeconds = 0;
  private measuredSimulatedSeconds = 0;
  stats: WeatherStats = { seconds: 0, maxWind: 0, cloudMass: 0, cloudFraction: 0, maxTemperatureAnomaly: 0, achievedSpeed: 0 };

  constructor(settings: Settings, private readonly receive: (snapshot: PreparedWeatherSnapshot) => void) {
    this.worker.onmessage = (event: MessageEvent<PreparedWeatherSnapshot>) => {
      if (event.data.revision !== this.revision || event.data.opticsRevision!==this.opticsRevision) return;
      this.ready=true;
      this.busy = false;
      const elapsed=this.activeSeconds-this.measuredActiveSeconds;
      const advanced=event.data.stats.seconds!==this.measuredSimulatedSeconds;
      const achievedSpeed=advanced && elapsed>0 ? (event.data.stats.seconds-this.measuredSimulatedSeconds)/elapsed : this.stats.achievedSpeed;
      this.stats = {...event.data.stats,achievedSpeed};
      if (advanced) {
        this.measuredActiveSeconds=this.activeSeconds;
        this.measuredSimulatedSeconds=event.data.stats.seconds;
      }
      this.receive({...event.data,stats:this.stats});
    };
    this.reset(settings);
  }

  reset(settings: Settings) {
    this.revision++;
    this.ready=false;this.transportState='';
    this.busy = true;
    this.accumulator = 0;
    this.activeSeconds=this.measuredActiveSeconds=this.measuredSimulatedSeconds=0;
    this.stats.achievedSpeed=0;
    this.worker.postMessage({ type: 'reset', settings: { ...settings }, revision: this.revision });
  }

  /** Reprepare paused fields too. Old step/configuration replies are ignored,
   * and the renderer waits for a snapshot matching these optical settings. */
  configure(settings:Settings,optics:CacheOptics) {
    const key=weatherTransportKey(settings);
    if (key===this.transportState) return false;
    const particles=JSON.stringify([settings.aerosolRadius,settings.cloudRadius]);
    this.opticsRevision++;this.ready=false;this.busy=true;this.transportState=key;
    this.worker.postMessage({type:'transport',settings:{...settings},revision:this.revision,opticsRevision:this.opticsRevision,
      optics:particles!==this.particleState ? optics : undefined});
    this.particleState=particles;
    return true;
  }

  matches(settings:Settings) {return this.ready && this.transportState===weatherTransportKey(settings);}

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
