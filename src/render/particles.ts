import { PHASE_TABLE_SIZE, SPECTRAL_BINS, summarizeOptics } from './mie';
import type { ParticleOptics } from './mie';

export interface ParticleTask {
  revision: number;
  population: number;
  radius: number;
  start: number;
  end: number;
}
export interface ParticleResult extends ParticleTask { data: Float32Array }
export type Populations = [ParticleOptics, ParticleOptics];

/** Bounded CPU pool. Superseded slider jobs finish only their current four rows;
 * their remaining work is replaced, and only complete current tables are used. */
export class ParticlePool {
  private readonly workers: { worker: Worker; busy: boolean }[];
  private revision = 0;
  private tasks: ParticleTask[] = [];
  private readonly cache: ({ radius: number; optics: ParticleOptics } | undefined)[] = [];
  private tables: Float32Array[] = [];
  private remaining = [0, 0];
  private radii = [0, 0];
  private receive!: (populations: Populations) => void;

  constructor(count = Math.max(1, Math.min(4, navigator.hardwareConcurrency - 2)), onError: (error: ErrorEvent) => void = event => { throw new Error(event.message); }) {
    this.workers = Array.from({ length: count }, () => {
      const slot = { worker: new Worker(new URL('./particles.worker.ts', import.meta.url), { type: 'module' }), busy: false };
      slot.worker.onerror = onError;
      slot.worker.onmessage = ({ data }: MessageEvent<ParticleResult>) => {
        slot.busy = false;
        if (data.revision === this.revision) {
          this.tables[data.population].set(data.data, data.start * PHASE_TABLE_SIZE * 4);
          this.remaining[data.population] -= data.end - data.start;
          if (this.remaining[data.population] === 0) {
            this.cache[data.population] = { radius: data.radius, optics: summarizeOptics(this.tables[data.population]) };
          }
          this.deliver();
        }
        this.dispatch();
      };
      return slot;
    });
  }

  request(aerosolRadius: number, cloudRadius: number, receive: (populations: Populations) => void) {
    this.revision++;
    this.receive = receive;
    this.radii = [aerosolRadius, cloudRadius];
    this.tasks = [];
    this.remaining = [0, 0];
    this.radii.forEach((radius, population) => {
      if (this.cache[population]?.radius === radius) return;
      this.tables[population] = new Float32Array(SPECTRAL_BINS * PHASE_TABLE_SIZE * 4);
      this.remaining[population] = SPECTRAL_BINS;
      for (let start = 0; start < SPECTRAL_BINS; start += 4) {
        this.tasks.push({ revision: this.revision, population, radius, start, end: Math.min(start + 4, SPECTRAL_BINS) });
      }
    });
    this.deliver();
    this.dispatch();
  }

  private deliver() {
    if (this.remaining.some(rows => rows > 0)) return;
    this.receive([this.cache[0]!.optics, this.cache[1]!.optics]);
  }

  private dispatch() {
    for (const slot of this.workers) {
      if (slot.busy || this.tasks.length === 0) continue;
      slot.busy = true;
      slot.worker.postMessage(this.tasks.shift()!);
    }
  }

  dispose() { for (const { worker } of this.workers) worker.terminate(); }
}
