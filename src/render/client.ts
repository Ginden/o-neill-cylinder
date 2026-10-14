import { Matrix4, PerspectiveCamera } from 'three';
import type { Settings } from '../settings';
import type { RenderRequest, RenderResponse, RenderState, RenderStats } from './protocol';

/** The DOM owns input and the camera; the worker owns WebGL and simulation.
 * One unacknowledged state at most, so a busy GPU never queues old input. */
export class RenderClient {
  readonly camera = new PerspectiveCamera(70, 1, 0.001, 200);
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly previousCamera = new Matrix4();
  private busy = true;
  private dirty = true;
  private interacting = false;
  private restartWeather = false;
  private settings: Settings;
  private width: number;
  private height: number;
  private pixelRatio = devicePixelRatio;
  private nextScreenshot = 0;
  private readonly screenshots = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();
  stats: RenderStats = {
    samples: 0, mode: 'preview', raySize: '', accumulation: 0, luminance: null, clearAirBlueExtinction: 0,
    weather: { seconds: 0, maxWind: 0, cloudMass: 0, cloudFraction: 0, maxTemperatureAnomaly: 0 },
    fps: 0, sampleRate: 0
  };

  constructor(canvas: HTMLCanvasElement, settings: Settings, private readonly onError: (error: Error) => void) {
    this.settings = { ...settings };
    this.width = Math.max(1, canvas.clientWidth);
    this.height = Math.max(1, canvas.clientHeight);
    this.worker.onerror = event => this.fail(new Error(event.message));
    this.worker.onmessage = ({ data }: MessageEvent<RenderResponse>) => {
      if (data.type === 'ack') this.busy = false;
      else if (data.type === 'stats') {
        this.stats = data.stats;
        canvas.dataset.samples = String(data.stats.samples);
        canvas.dataset.mode = data.stats.mode;
        canvas.dataset.raySize = data.stats.raySize;
        canvas.dataset.accumulation = String(data.stats.accumulation);
        // Each new sample, mode or image size is an event: scripts and tests
        // wait for it instead of polling.
        canvas.dispatchEvent(new CustomEvent<RenderStats>('renderstate', { detail: data.stats }));
      } else if (data.type === 'screenshot') {
        this.screenshots.get(data.id)!.resolve(data.blob);
        this.screenshots.delete(data.id);
      } else this.fail(new Error(data.message));
    };
    const offscreen = canvas.transferControlToOffscreen();
    this.post({ type: 'init', canvas: offscreen, state: this.state(false) }, [offscreen]);
    this.setVisible(!document.hidden);
  }

  private post(message: RenderRequest, transfer: Transferable[] = []) { this.worker.postMessage(message, transfer); }
  private state(interacting: boolean): RenderState {
    return {
      settings: this.settings, width: this.width, height: this.height, pixelRatio: this.pixelRatio,
      position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray(),
      interacting, resetWeather: this.restartWeather
    };
  }

  apply(settings: Settings) { this.settings = { ...settings }; this.dirty = true; }
  setVisible(visible: boolean) { this.post({ type: 'visibility', visible }); }
  resetWeather() { this.restartWeather = true; this.dirty = true; }
  resize(width: number, height: number) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.pixelRatio = devicePixelRatio;
    this.dirty = true;
  }

  update(interacting: boolean) {
    if (this.busy) return;
    this.camera.updateMatrixWorld();
    if (!this.dirty && interacting === this.interacting && this.camera.matrixWorld.equals(this.previousCamera)) return;
    this.post({ type: 'state', state: this.state(interacting) });
    this.previousCamera.copy(this.camera.matrixWorld);
    this.interacting = interacting;
    this.busy = true; this.dirty = false; this.restartWeather = false;
  }

  screenshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const id = this.nextScreenshot++;
      this.screenshots.set(id, { resolve, reject });
      this.post({ type: 'screenshot', id });
    });
  }

  private fail(error: Error) { this.dispose(); this.onError(error); }
  dispose() {
    this.worker.terminate();
    this.busy = true;
    for (const pending of this.screenshots.values()) pending.reject(new Error('Renderer stopped.'));
    this.screenshots.clear();
  }
}
