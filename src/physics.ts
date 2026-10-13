import type { Settings } from './settings';
import { dot, glassPlate, intersectMirror, mirrorGeometry, reflect, sunDirection, windowOpening } from './optics';

export const AIR_GAS_CONSTANT = 287.05;
export const HEAT_CAPACITY = 1005;
export const LATENT_HEAT = 2.5e6;
export const EARTH_GRAVITY = 9.80665;
export const RAYLEIGH_PER_KM = [0.005802, 0.013558, 0.0331] as const;

/** Wavelength-dependent dry-air coefficient, at 1013.25 hPa and 288.15 K. */
export function rayleighPerKm(wavelengthNm:number) {
  const index=(lambda:number)=>{
    const sigma2=1/(lambda/1000)**2;
    const n=1+1e-8*(8342.13+2406030/(130-sigma2)+15997/(38.9-sigma2));
    return (n*n-1)/(n*n+2);
  };
  return 0.013558*(550/wavelengthNm)**4*(index(wavelengthNm)/index(550))**2;
}

export function angularVelocity(s: Pick<Settings, 'gravity' | 'radius'>): number {
  return Math.sqrt(s.gravity * EARTH_GRAVITY / (s.radius * 1000));
}

export function effectiveAltitude(radiusKm: number, radialKm: number): number {
  return (radiusKm * radiusKm - radialKm * radialKm) / (2 * radiusKm);
}

/** Hydrostatic ideal gas in the centrifugal potential, with a specified lapse. */
export function backgroundAt(radialKm: number, s: Settings) {
  const h = effectiveAltitude(s.radius, Math.min(radialKm, s.radius)) * 1000;
  const wallT = s.temperature + 273.15;
  const lapse = s.lapseRate / 1000;
  const temperature = wallT - lapse * h;
  const g = s.gravity * EARTH_GRAVITY;
  const pressure = s.pressure * 100 * (lapse < 1e-8
    ? Math.exp(-g * h / (AIR_GAS_CONSTANT * wallT))
    : Math.pow(temperature / wallT, g / (AIR_GAS_CONSTANT * lapse)));
  const density = pressure / (AIR_GAS_CONSTANT * temperature);
  return { temperature, pressure, density, altitude: h };
}

export function saturationMixingRatio(temperature: number, pressure: number): number {
  if (pressure <= 0) return 0;
  const celsius = temperature - 273.15;
  const vaporPressure = 611.2 * Math.exp(17.67 * celsius / (celsius + 243.5));
  return 0.622 * vaporPressure / Math.max(pressure - vaporPressure, 1);
}

/** Saturation adjustment conserves total water and cp*T + Lv*qv. */
export function equilibrate(temperature: number, vapor: number, cloud: number, pressure: number) {
  if (pressure <= 0) return { temperature, vapor: 0, cloud: 0 };
  const total = vapor + cloud;
  const energy = HEAT_CAPACITY * temperature + LATENT_HEAT * vapor;
  let lo = 0;
  let hi = total;
  // Solve for equilibrium vapor, including warming due to latent heat release.
  for (let iteration = 0; iteration < 24; iteration++) {
    const candidate = (lo + hi) * 0.5;
    const t = (energy - LATENT_HEAT * candidate) / HEAT_CAPACITY;
    if (candidate > saturationMixingRatio(t, pressure)) hi = candidate;
    else lo = candidate;
  }
  const q = Math.min(total, (lo + hi) * 0.5);
  return { temperature: (energy - LATENT_HEAT * q) / HEAT_CAPACITY, vapor: q, cloud: total - q };
}

export function isWindow(theta: number, fraction: number): boolean {
  const phase = (theta + Math.PI / 2) / (2 * Math.PI / 3);
  const distance = Math.abs(phase - Math.round(phase));
  return distance > (1 - fraction) * 0.5;
}

export function lightDirections(s: Settings): [number, number, number][] {
  const sun = sunDirection(s);
  return s.lightMode === 'sun' ? [sun] : [sun, ...mirrorGeometry(s).map(panel => reflect(sun,panel.normal))];
}

/** Distance from an interior point to the sidewall or sealed endcap, in km. */
export function boundaryDistance(p: readonly number[], d: readonly number[], radius: number, length: number) {
  const a = d[0] ** 2 + d[1] ** 2;
  const b = p[0] * d[0] + p[1] * d[1];
  const c = p[0] ** 2 + p[1] ** 2 - radius ** 2;
  const side = a < 1e-12 ? Infinity : (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a;
  const cap = Math.abs(d[2]) < 1e-12 ? Infinity : (Math.sign(d[2]) * length / 2 - p[2]) / d[2];
  return Math.min(side, cap);
}

export function directIllumination(p: readonly number[], s: Settings) {
  let sum = 0;
  const panels = s.lightMode === 'mirrors' ? mirrorGeometry(s) : [];
  for (const [source,d] of lightDirections(s).entries()) {
    const t = boundaryDistance(p, d, s.radius, s.length);
    const x = p[0] + d[0] * t;
    const y = p[1] + d[1] * t;
    const z = p[2] + d[2] * t;
    if (windowOpening([x,y,z],s)) {
      const exit = [x+d[0]*1e-4,y+d[1]*1e-4,z+d[2]*1e-4];
      const hits = panels.map(panel=>intersectMirror(exit,d,panel));
      let throughput = 1;
      if (source === 0 && hits.some(Number.isFinite)) continue;
      if (source > 0) {
        const index = source-1, panel = panels[index];
        if (!Number.isFinite(hits[index]) || hits[index]!==Math.min(...hits) || dot(d,panel.normal)<=0) continue;
        throughput = s.mirrorReflectivity;
      }
      const cosine = (x*d[0]+y*d[1])/s.radius;
      throughput *= glassPlate(cosine,s.windowTransmission).transmission;
      const r = Math.hypot(p[0], p[1]);
      sum += throughput*Math.max(0, -(p[0] * d[0] + p[1] * d[1]) / Math.max(r, 0.001));
    }
  }
  return sum * s.solarPower;
}

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
