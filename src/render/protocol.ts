import type { Settings } from '../settings';
import type { WeatherStats } from '../weather/solver';

export interface RenderState {
  settings: Settings;
  width: number;
  height: number;
  pixelRatio: number;
  position: number[];
  quaternion: number[];
  interacting: boolean;
  resetWeather: boolean;
}

export interface RenderStats {
  samples: number;
  mode: 'preview' | 'path';
  raySize: string;
  luminance: number | null;
  clearAirBlueExtinction: number;
  weather: WeatherStats;
  fps: number;
  sampleRate: number;
}

export type RenderRequest =
  | { type: 'init'; canvas: OffscreenCanvas; state: RenderState }
  | { type: 'state'; state: RenderState }
  | { type: 'visibility'; visible: boolean }
  | { type: 'screenshot'; id: number };

export type RenderResponse =
  | { type: 'ack' }
  | { type: 'stats'; stats: RenderStats }
  | { type: 'screenshot'; id: number; blob: Blob }
  | { type: 'error'; message: string };
