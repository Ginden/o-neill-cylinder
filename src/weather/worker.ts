/// <reference lib="webworker" />
import type { Settings } from '../settings';
import { WeatherSolver } from './solver';

let solver: WeatherSolver;
let revision = 0;

self.onmessage = (event: MessageEvent<
  { type: 'reset'; settings: Settings; revision: number }
  | { type: 'step'; dt: number; revision: number }
>) => {
  const message = event.data;
  if (message.type === 'reset') {
    revision = message.revision;
    solver = new WeatherSolver(message.settings);
  } else {
    if (message.revision !== revision) return;
    // Substeps honor the CFL and rotation limits while preserving requested time.
    let remaining = message.dt;
    for (let i = 0; remaining > 0.001 && i < 32; i++) remaining -= solver.step(remaining);
  }
  const snapshot = solver.snapshot();
  self.postMessage({ ...snapshot, revision }, { transfer: [snapshot.data.buffer] });
};
