import { particleOpticsRows } from './mie';
import type { ParticleTask, ParticleResult } from './particles';

self.onmessage = ({ data: task }: MessageEvent<ParticleTask>) => {
  const data = particleOpticsRows(task.radius, 0.35, task.population === 0 ? [1.5, 0.01] : [1.333, 1e-9], task.start, task.end);
  const result: ParticleResult = { ...task, data };
  self.postMessage(result, { transfer: [data.buffer] });
};
