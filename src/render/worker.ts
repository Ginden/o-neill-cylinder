import { HabitatRenderer } from './renderer';
import { ParticlePool } from './particles';
import type { Populations } from './particles';
import { WeatherClient } from '../weather/client';
import type { WeatherSnapshot } from '../weather/client';
import type { RenderRequest, RenderResponse, RenderState } from './protocol';

let canvas: OffscreenCanvas;
let renderer: HabitatRenderer | undefined;
let weather: WeatherClient;
let latestWeather: WeatherSnapshot | undefined;
let weatherDirty = false;
let state: RenderState;
let populations: Populations | undefined;
let particleState = '';
let appliedState = '';
let size = '';
let previous = performance.now();
let lastStats = 0;
let lastRate = 0;
let frames = 0;
let paths = 0;
let fps = 0;
let sampleRate = 0;
let frameHandle = 0;
let refinementHandle: ReturnType<typeof setTimeout>;
let visible = true;

function stopFrames() { cancelAnimationFrame(frameHandle); clearTimeout(refinementHandle); }

function post(message: RenderResponse) { self.postMessage(message); }
function fail(error: unknown) {
  stopFrames();
  particles.dispose();
  weather?.dispose();
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
const particles = new ParticlePool(undefined, event => fail(new Error(event.message)));

function applyState() {
  if (!populations) return;
  const nextState = JSON.stringify(state.settings);
  if (!renderer) {
    renderer = new HabitatRenderer(canvas, state.settings, populations);
    appliedState = nextState;
  } else if (appliedState !== nextState) {
    renderer.apply(state.settings, populations);
    appliedState = nextState;
  }
  const nextSize = JSON.stringify([state.width, state.height, state.pixelRatio, state.settings.quality]);
  if (nextSize !== size) {
    renderer.resize(state.width, state.height, state.settings.quality, state.pixelRatio);
    size = nextSize;
  }
}

function updateState(next: RenderState) {
  state = next;
  if (state.resetWeather) weather.reset(state.settings);
  const key = JSON.stringify([state.settings.aerosolRadius, state.settings.cloudRadius]);
  if (key !== particleState) {
    particleState = key;
    populations = undefined;
    particles.request(state.settings.aerosolRadius, state.settings.cloudRadius, result => {
      populations = result;
      try { applyState(); } catch (error) { fail(error); }
    });
  }
  applyState();
  post({ type: 'ack' });
}

function frame(now: number) {
  try {
    weather.update((now - previous) / 1000, state.settings);
    previous = now;
    if (renderer) {
      if (weatherDirty && !renderer.sampleInProgress) {
        renderer.setWeather(latestWeather!);
        weatherDirty = false;
      }
      renderer.camera.position.fromArray(state.position);
      renderer.camera.quaternion.fromArray(state.quaternion);
      const samples = renderer.samples;
      if (renderer.render(state.interacting)) {
        frames++;
        if (renderer.mode === 'path') paths++;
      }
      // Count submitted paths directly, including accumulation resets from weather.
      if (now - lastRate >= 500) {
        fps = frames * 1000 / (now - lastRate);
        sampleRate = paths * 1000 / (now - lastRate);
        frames = 0; paths = 0; lastRate = now;
      }
      if (now - lastStats >= 100 || (samples === 0 && renderer.samples > 0)) {
        post({ type: 'stats', stats: {
          samples: renderer.samples, mode: renderer.mode, raySize: renderer.raySize,
          luminance: renderer.luminance(), clearAirBlueExtinction: renderer.clearAirBlueExtinction,
          weather: weather.stats, fps, sampleRate
        } });
        lastStats = now;
      }
    }
    if (visible) {
      // Refinement is fenced by the GPU, not the monitor refresh. Yield between
      // bands without wasting a whole vsync waiting for a fence to signal.
      if (renderer?.mode === 'path' && !state.interacting) refinementHandle = setTimeout(() => frame(performance.now()), 0);
      else frameHandle = requestAnimationFrame(frame);
    }
  } catch (error) { fail(error); }
}

self.onmessage = ({ data }: MessageEvent<RenderRequest>) => {
  try {
    if (data.type === 'init') {
      canvas = data.canvas;
      weather = new WeatherClient(data.state.settings, snapshot => {
        latestWeather = snapshot;
        weatherDirty = true;
      });
      updateState(data.state);
      previous = lastRate = performance.now();
      frameHandle = requestAnimationFrame(frame);
    } else if (data.type === 'state') updateState(data.state);
    else if (data.type === 'visibility') {
      if (visible === data.visible) return;
      visible = data.visible;
      stopFrames();
      if (visible) {
        previous = lastRate = performance.now(); frames = 0; paths = 0;
        frameHandle = requestAnimationFrame(frame);
      }
    } else {
      void canvas.convertToBlob({ type: 'image/png' }).then(blob => {
        post({ type: 'screenshot', id: data.id, blob });
      }).catch(fail);
    }
  } catch (error) { fail(error); }
};
