import type { Settings } from '../settings';
import { defaults, presets } from '../settings';

type NumericKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
export interface SliderSpec {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
  scale?: number;
  logarithmic?: boolean;
}

export const sliders: Record<string, SliderSpec[]> = {
  habitat: [
    { key: 'radius', label: 'Radius', min: 0.5, max: 20, step: 0.1, unit: 'km' },
    { key: 'length', label: 'Length', min: 2, max: 80, step: 1, unit: 'km' },
    { key: 'gravity', label: 'Gravity at the wall', min: 0, max: 1.5, step: 0.05, unit: 'g' },
    { key: 'windowFraction', label: 'Window coverage', min: 0.1, max: 0.7, step: 0.01, unit: '%', scale: 100, hint: 'Three land strips alternate with three sealed windows.' },
    { key: 'terrainHeight', label: 'Terrain relief', min: 0, max: 0.4, step: 0.01, unit: 'm', scale: 1000 },
    { key: 'pressure', label: 'Wall pressure', min: 0, max: 1500, step: 0.25, unit: 'hPa' },
    { key: 'temperature', label: 'Wall temperature', min: 0, max: 35, step: 1, unit: '°C' },
    { key: 'lapseRate', label: 'Temperature lapse', min: 0, max: 10, step: 0.1, unit: 'K/km', hint: 'Per kilometre of centrifugal potential height; gravity decreases toward the axis.' }
  ],
  light: [
    { key: 'solarPower', label: 'Solar irradiance', min: 0, max: 2, step: 0.01, unit: '×' },
    { key: 'windowTransmission', label: 'Glass bulk transmission', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, hint: 'Absorption multiplier. Fresnel reflection is calculated separately for both interfaces, with wavelength-dependent BK7 refractive index.' },
    { key: 'mirrorTilt', label: 'Mirror deployment offset', min: -35, max: 35, step: 1, unit: '°', hint: 'Three finite panels are hinged at the −Z end of the windows. Zero deploys them at 45°. Reflected light follows their surface normals.' },
    { key: 'mirrorReflectivity', label: 'Mirror reflectivity', min: 0, max: 1, step: 0.01, unit: '%', scale: 100 },
    { key: 'sunAzimuth', label: 'Sun azimuth', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'sunElevation', label: 'Sun elevation toward +Z', min: -90, max: 90, step: 1, unit: '°', hint: '90° places the Sun along the cylinder axis. Solar diameter is 0.533° at 1 au; its finite disk produces penumbras.' },
    { key: 'aerosol', label: 'Aerosol extinction', min: 0, max: 0.08, step: 0.001, unit: '/km', hint: 'At reference air density and 550 nm. Particle size sets wavelength-dependent scattering and absorption.' },
    { key: 'aerosolRadius', label: 'Aerosol effective radius', min: 0.03, max: 1, step: 0.01, unit: 'µm', hint: 'Mie scattering for a lognormal sphere population (log width 0.35, refractive index 1.50 + 0.01i). Extinction is specified at 550 nm.' },
    { key: 'cloudRadius', label: 'Cloud effective radius', min: 3, max: 25, step: 1, unit: 'µm', hint: 'Mie scattering from liquid-water spheres (n = 1.333 + 10⁻⁹i); lognormal width 0.35. Extinction follows the modeled liquid-water mass.' }
  ],
  weather: [
    { key: 'humidity', label: 'Initial wall humidity', min: 0, max: 100, step: 1, unit: '%', hint: 'Initially mixed vapor can condense in colder central air. Changes restart the weather.' },
    { key: 'surfaceHeating', label: 'Surface-layer heating', min: 0, max: 0.05, step: 0.001, unit: 'K/min', scale: 60 },
    { key: 'evaporation', label: 'Surface vapor source', min: 0, max: 0.00003, step: 0.000001, unit: 'g/kg/min', scale: 60000 },
    { key: 'wind', label: 'Initial axial breeze', min: 0, max: 20, step: 0.5, unit: 'm/s' },
    { key: 'timeScale', label: 'Simulation speed', min: 1, max: 600, step: 1, unit: '×' },
    { key: 'seed', label: 'Weather seed', min: 1, max: 999, step: 1, unit: '' }
  ],
  display: [
    { key: 'exposure', label: 'Exposure compensation', min: 0.0625, max: 4096, step: 0.1, unit: 'stops', logarithmic: true, hint: 'Each stop doubles brightness. Use a fixed value for comparisons; exposure changes the photograph, not physical luminance or human dark adaptation.' }
  ]
};

export function formatValue(spec: SliderSpec, value: number) {
  if (spec.logarithmic) return `${Math.log2(value).toFixed(1)} ${spec.unit}`;
  const scaled = value * (spec.scale ?? 1);
  const precision = spec.step * (spec.scale ?? 1) < 0.01 ? 3 : spec.step * (spec.scale ?? 1) < 1 ? 2 : 0;
  return `${scaled.toFixed(precision).replace(/\.0+$/, '')} ${spec.unit}`.trim();
}

function slider(spec: SliderSpec, settings: Settings) {
  return `<div class="control"><label for="${spec.key}">${spec.label}<output id="${spec.key}-value">${formatValue(spec, settings[spec.key])}</output></label>
    <input type="range" id="${spec.key}" min="${spec.logarithmic ? Math.log2(spec.min) : spec.min}" max="${spec.logarithmic ? Math.log2(spec.max) : spec.max}" step="${spec.step}" value="${spec.logarithmic ? Math.log2(settings[spec.key]) : settings[spec.key]}" aria-describedby="${spec.key}-hint" />
    <p id="${spec.key}-hint" class="hint">${spec.hint ?? ''}</p></div>`;
}

export function renderControls(settings: Settings) {
  return `<div class="panel-heading"><span class="eyebrow">EXPERIMENT PARAMETERS</span><h2>Shape your sky.</h2><p>Change the habitat. Watch the light respond.</p></div>
    <label class="preset-label" for="preset">Starting conditions</label>
    <select id="preset"><option value="Custom">Custom experiment</option>${Object.keys(presets).map(name => `<option ${name === 'Clear daylight' ? 'selected' : ''}>${name}</option>`).join('')}</select>
    <div class="tabs" role="tablist" aria-label="Parameter categories">${['habitat','light','weather','display'].map((tab,i) => `<button role="tab" id="tab-${tab}" aria-controls="pane-${tab}" aria-selected="${i === 0}" data-tab="${tab}" tabindex="${i === 0 ? 0 : -1}">${tab}</button>`).join('')}</div>
    <div class="panes">${Object.entries(sliders).map(([group,specs],i) => `<section role="tabpanel" id="pane-${group}" aria-labelledby="tab-${group}" ${i ? 'hidden' : ''}>
      ${group === 'light' ? `<label class="select-label" for="lightMode">Illumination</label><select id="lightMode"><option value="mirrors">Sun + exterior mirror panels</option><option value="sun">Sun · mirrors removed</option></select>` : ''}
      ${group === 'weather' ? `<label class="toggle"><span>Simulate clouds</span><input id="clouds" type="checkbox" ${settings.clouds ? 'checked' : ''}/></label><div class="weather-note">A coarse moist-convection model. Clouds emerge through condensation; water and latent heat are exchanged together.</div>` : ''}
      ${group === 'display' ? `<label class="toggle"><span>Atmospheric scattering</span><input id="atmosphere" type="checkbox" ${settings.atmosphere ? 'checked' : ''}/></label><label class="select-label" for="quality">Image resolution</label><select id="quality"><option value="fast">Fast · 45% resolution</option><option value="balanced">Balanced · 70% resolution</option><option value="high">High · full resolution</option></select><p class="hint">All qualities trace the same physical light paths. Hold the camera still to accumulate samples. Pause clouds for a converged still image.</p><label class="select-label" for="diagnostic">View layer</label><select id="diagnostic"><option value="natural">Natural light</option><option value="transmission">RGB transmittance</option><option value="density">Air column</option><option value="cloud">Liquid-water column</option></select>` : ''}
      ${specs.map(spec => slider(spec,settings)).join('')}
      ${group === 'weather' ? `<div class="weather-stats"><div><span>Cloud volume</span><strong id="cloud-fraction">—</strong></div><div><span>Peak wind</span><strong id="max-wind">—</strong></div><div><span>Liquid water</span><strong id="cloud-mass">—</strong></div></div><button class="secondary wide" id="reset-weather">Restart weather</button>` : ''}
      ${group === 'display' ? `<button class="secondary wide" id="export-settings">Export experiment JSON</button><label class="secondary wide import-label" for="import-settings">Import experiment JSON<input id="import-settings" type="file" accept="application/json,.json"/></label>` : ''}
    </section>`).join('')}</div>
    <div class="panel-footer"><button class="text-button" id="reset-all">Reset experiment</button><button class="text-button" id="model-details">Model & assumptions ↗</button></div>`;
}

export function syncControls(settings: Settings) {
  for (const specs of Object.values(sliders)) for (const spec of specs) {
    (document.getElementById(spec.key) as HTMLInputElement).value = String(spec.logarithmic ? Math.log2(settings[spec.key]) : settings[spec.key]);
    document.getElementById(`${spec.key}-value`)!.textContent = formatValue(spec, settings[spec.key]);
  }
  for (const key of ['clouds','atmosphere'] as const) (document.getElementById(key) as HTMLInputElement).checked = settings[key];
  for (const key of ['lightMode','quality','diagnostic'] as const) (document.getElementById(key) as HTMLSelectElement).value = settings[key];
}

/** Shared links / imported experiments are untrusted input, so constrain their values. */
export function parseSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('Expected an experiment settings object.');
  const s = { ...defaults };
  const values = input as Record<string, unknown>;
  for (const specs of Object.values(sliders)) for (const spec of specs) {
    const value = values[spec.key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${spec.label.toLowerCase()}.`);
    s[spec.key] = Math.max(spec.min, Math.min(spec.max, value));
  }
  const enums = {
    lightMode: ['mirrors','sun'], quality: ['fast','balanced','high'],
    diagnostic: ['natural','transmission','density','cloud'], view: ['valley','axis','overlook']
  } as const;
  for (const [key, allowed] of Object.entries(enums)) {
    if (values[key] !== undefined) {
      if (!(allowed as readonly unknown[]).includes(values[key])) throw new Error(`Invalid ${key}.`);
      Object.assign(s, { [key]: values[key] });
    }
  }
  for (const key of ['clouds','atmosphere','paused'] as const) {
    if (values[key] !== undefined) {
      if (typeof values[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
      s[key] = values[key];
    }
  }
  // Keep terrain below half the radius even in shared or imported small habitats.
  s.terrainHeight = Math.min(s.terrainHeight, s.radius * 0.2);
  return s;
}
