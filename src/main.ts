import './style.css';
import { defaults, presets, weatherKeys } from './settings';
import type { Settings } from './settings';
import { angularVelocity, backgroundAt, boundaryDistance } from './physics';
import { HabitatRenderer } from './render/renderer';
import { Navigation } from './render/navigation';
import { WeatherClient } from './weather/client';
import { layout } from './ui/layout';
import { formatValue, parseSettings, sliders, syncControls } from './ui/controls';
import { icon } from './ui/icons';

const settings = { ...defaults };
const params = new URLSearchParams(location.search);
let linkError = '';
if (params.has('s')) {
  try { Object.assign(settings, parseSettings(JSON.parse(atob(params.get('s')!)))); }
  catch { linkError = 'This experiment link is invalid. Loaded the default experiment.'; }
}
document.querySelector<HTMLDivElement>('#app')!.innerHTML = layout(settings);
syncControls(settings);
if (params.has('s')) (document.getElementById('preset') as HTMLSelectElement).value = 'Custom';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('scene');
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const node = element('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 5000);
}

function saveFile(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
}

function start() {
  const renderer = new HabitatRenderer(canvas, settings);
  const navigation = new Navigation(renderer.camera, canvas, settings);
  const weather = new WeatherClient(settings, snapshot => renderer.setWeather(snapshot));
  let resetTimer: ReturnType<typeof setTimeout>;
  let fps = 0;
  let sampleRate=0;
  let lastReadoutSamples=0;
  let elapsed = 0;
  let frames = 0;
  let previous = performance.now();
  const cameraDirection = renderer.camera.position.clone();

  function resize() {
    renderer.resize(canvas.clientWidth, canvas.clientHeight, settings.quality);
  }
  new ResizeObserver(resize).observe(element('scene').parentElement!);
  resize();

  function refresh(changed: (keyof Settings)[], resetCamera = false) {
    settings.terrainHeight = Math.min(settings.terrainHeight, settings.radius * 0.2);
    renderer.apply(settings);
    if (changed.includes('quality')) resize();
    if (resetCamera || changed.includes('view') || changed.includes('radius') || changed.includes('length') || changed.includes('terrainHeight')) {
      navigation.setView(settings.view);
    }
    if (changed.some(key => weatherKeys.includes(key))) {
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => weather.reset(settings), 180);
    }
    element('speed-label').textContent = settings.clouds && settings.pressure > 0 ? `${settings.timeScale}×` : 'Weather off';
    element<HTMLButtonElement>('pause').disabled = !settings.clouds || settings.pressure <= 0;
    element<HTMLButtonElement>('pause').innerHTML = icon(settings.paused ? 'play' : 'pause');
    element<HTMLButtonElement>('pause').setAttribute('aria-label', settings.paused ? 'Resume weather' : 'Pause weather');
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === settings.view));
    }
  }

  for (const specs of Object.values(sliders)) for (const spec of specs) {
    element<HTMLInputElement>(spec.key).addEventListener('input', event => {
      const value = Number((event.target as HTMLInputElement).value);
      settings[spec.key] = spec.logarithmic ? 2 ** value : value;
      element(`${spec.key}-value`).textContent = formatValue(spec, settings[spec.key]);
      if (spec.key === 'radius' || spec.key === 'terrainHeight') {
        settings.terrainHeight = Math.min(settings.terrainHeight, settings.radius * 0.2);
        const relief = sliders.habitat.find(s => s.key === 'terrainHeight')!;
        element<HTMLInputElement>('terrainHeight').value = String(settings.terrainHeight);
        element('terrainHeight-value').textContent = formatValue(relief, settings.terrainHeight);
      }
      element<HTMLSelectElement>('preset').value = 'Custom';
      refresh([spec.key]);
    });
  }
  for (const key of ['clouds','atmosphere','denoise'] as const) element<HTMLInputElement>(key).addEventListener('change', event => {
    settings[key] = (event.target as HTMLInputElement).checked;
    refresh([key]);
    element<HTMLSelectElement>('preset').value = 'Custom';
  });
  for (const key of ['lightMode','quality','diagnostic'] as const) element<HTMLSelectElement>(key).addEventListener('change', event => {
    Object.assign(settings, { [key]: (event.target as HTMLSelectElement).value });
    refresh([key]);
    element<HTMLSelectElement>('preset').value = 'Custom';
  });

  function loadExperiment(value: Settings) {
    Object.assign(settings, value);
    syncControls(settings);
    refresh(Object.keys(settings) as (keyof Settings)[], true);
  }
  element<HTMLSelectElement>('preset').addEventListener('change', event => {
    const name = (event.target as HTMLSelectElement).value;
    if (presets[name]) loadExperiment({ ...defaults, ...presets[name] });
  });
  element('reset-all').addEventListener('click', () => {
    loadExperiment({ ...defaults });
    element<HTMLSelectElement>('preset').value = 'Clear daylight';
    toast('Experiment reset.');
  });
  element('reset-weather').addEventListener('click', () => {
    clearTimeout(resetTimer); weather.reset(settings); toast('Weather restarted from the selected initial conditions.');
  });
  element('pause').addEventListener('click', () => { settings.paused = !settings.paused; refresh(['paused']); });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => {
    settings.view = button.dataset.view as Settings['view']; refresh(['view']);
  });
  element('recenter').addEventListener('click', () => navigation.setView(settings.view));

  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  function selectTab(button: HTMLButtonElement) {
    for (const tab of tabs) {
      const selected = tab === button;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      element(`pane-${tab.dataset.tab}`).hidden = !selected;
    }
  }
  for (const [index,button] of tabs.entries()) {
    button.addEventListener('click', () => selectTab(button));
    button.addEventListener('keydown', event => {
      let next: number;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else return;
      event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();
    });
  }
  const dialog = element<HTMLDialogElement>('model-dialog');
  element('model-details').addEventListener('click', () => dialog.showModal());
  element('close-model').addEventListener('click', () => dialog.close());
  element('snapshot').addEventListener('click', () => {
    saveFile(renderer.screenshot(), `oneill-${settings.view}-${Math.floor(weather.stats.seconds)}s.png`);
    toast('Saved the current view.');
  });
  element('export-settings').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
    saveFile(url, 'oneill-experiment.json'); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  element<HTMLInputElement>('import-settings').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      loadExperiment(parseSettings(JSON.parse(await file.text())));
      element<HTMLSelectElement>('preset').value = 'Custom';
      toast('Experiment imported. Weather starts from its initial conditions.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not import this experiment.'); }
    input.value = '';
  });
  element('share').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.searchParams.set('s', btoa(JSON.stringify(settings)));
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url.toString()); toast('Experiment link copied. It includes settings, not evolved weather.'); }
    catch { toast('The experiment link is in the address bar. Copy it to share these settings.'); }
  });

  function updateReadouts() {
    const luminance=settings.diagnostic==='natural' ? renderer.luminance() : null;
    element('luminance').textContent=luminance===null ? settings.diagnostic!=='natural' ? 'Diagnostic layer' : renderer.mode==='preview' ? 'Navigation preview' : 'Measuring…' : `${luminance>=1 ? luminance.toFixed(1) : luminance.toExponential(1)} cd/m²`;
    const omega = angularVelocity(settings);
    element('rotation').textContent = omega > 0 ? `${(2*Math.PI/omega/60).toFixed(2)} min / turn` : 'Not rotating';
    element('axis-pressure').textContent = `${(backgroundAt(0,settings).pressure/100).toFixed(0)} hPa`;
    renderer.camera.getWorldDirection(cameraDirection);
    const p = renderer.camera.position.toArray(), d = cameraDirection.toArray();
    const distance = boundaryDistance(p, d, settings.radius, settings.length);
    let column = 0;
    for (let i = 0; i < 24; i++) {
      const t = distance * (i + 0.5) / 24;
      const radius = Math.hypot(p[0]+d[0]*t,p[1]+d[1]*t);
      const b = backgroundAt(radius,settings);
      column += b.pressure / 101325 * 288.15 / b.temperature * distance / 24;
    }
    const transmission = settings.atmosphere ? Math.exp(-renderer.clearAirBlueExtinction*column) : 1;
    element('sightline').textContent = `${distance.toFixed(1)} km · B ${(transmission*100).toFixed(0)}%`;
    const seconds = Math.floor(weather.stats.seconds);
    element('sim-time').textContent = [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v => String(v).padStart(2,'0')).join(':');
    element('cloud-fraction').textContent = `${(weather.stats.cloudFraction*100).toFixed(1)}%`;
    element('max-wind').textContent = `${weather.stats.maxWind.toFixed(1)} m/s`;
    element('cloud-mass').textContent = `${(weather.stats.cloudMass/1e6).toFixed(1)} kt`;
    element('render-state').textContent=settings.diagnostic==='natural' && renderer.mode==='path'
      ? `Path tracing · ${renderer.samples} samples · ${sampleRate.toFixed(1)} samples/s`
      : `${renderer.mode==='preview' ? 'Navigation preview' : 'Diagnostic view'} · ${Math.round(fps)} fps`;
  }

  refresh([]);
  if (linkError) toast(linkError);
  let frameHandle: number;
  function frame(now: number) {
    const actualDt = (now-previous)/1000;
    const dt = Math.min(actualDt,0.1);
    previous = now;
    navigation.update(dt);
    weather.update(actualDt,settings);
    renderer.render(navigation.interacting);
    frames++; elapsed += actualDt;
    if (elapsed >= 0.5) {
      sampleRate=(renderer.samples>=lastReadoutSamples ? renderer.samples-lastReadoutSamples : renderer.samples)/elapsed;
      lastReadoutSamples=renderer.samples;
      fps = frames / elapsed; frames = 0; elapsed = 0;
      updateReadouts();
    }
    frameHandle = requestAnimationFrame(frame);
  }
  frameHandle = requestAnimationFrame(frame);
  window.addEventListener('pagehide', () => { cancelAnimationFrame(frameHandle); weather.dispose(); renderer.dispose(); }, { once: true });
}

try { start(); }
catch (error) {
  element('render-state').textContent = 'Renderer unavailable';
  const message = document.createElement('div');
  message.className = 'error-message';
  message.textContent = `The 3D renderer could not start. This experiment needs a browser with WebGL 2 enabled. ${error instanceof Error ? error.message : ''}`;
  element('scene').parentElement!.append(message);
  // Model notes remain available even when graphics initialization fails.
  element('model-details').addEventListener('click', () => element<HTMLDialogElement>('model-dialog').showModal());
  element('close-model').addEventListener('click', () => element<HTMLDialogElement>('model-dialog').close());
}
