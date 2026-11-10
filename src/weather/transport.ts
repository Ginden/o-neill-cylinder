import type { Settings } from '../settings';
import type { WeatherStats } from './solver';
import { diffusionFromOptics } from '../render/cache';
import type { CacheOptics } from '../render/cache';
import { cloudMajorants } from '../render/majorant';

export interface WeatherSnapshot {
  /** Liquid-water density in kg/m³, one value per grid cell. */
  data:Float32Array;
  stats:WeatherStats;
  dimensions:readonly [number,number,number];
  revision:number;
}
export interface PreparedWeatherSnapshot extends WeatherSnapshot {
  opticsRevision:number;
  transport:{majorants:Float32Array;diffusion?:Float32Array;absorption?:Float32Array;deep:boolean};
}

/** The settings that affect coefficients, majorants, or their use. Camera,
 * lighting, display, weather speed and pause changes need no new coefficients. */
export function weatherTransportKey(s:Settings) {
  return JSON.stringify([s.radius,s.length,s.gravity,s.pressure,s.temperature,s.lapseRate,
    s.terrainHeight,s.aerosol,s.aerosolRadius,s.cloudRadius,s.clouds,s.atmosphere,s.diagnostic]);
}

/** Runs on the weather worker; also used by isolated renderer experiments. */
export function prepareWeather(snapshot:WeatherSnapshot,s:Settings,optics:CacheOptics,opticsRevision=0):PreparedWeatherSnapshot {
  const majorants=cloudMajorants(snapshot.data,snapshot.dimensions,optics.cloudMaximumExtinction);
  const cacheActive=s.clouds && s.atmosphere && s.pressure>0 && snapshot.stats.cloudMass>0 && s.diagnostic==='natural';
  const coefficients=cacheActive ? diffusionFromOptics(snapshot,s,optics) : {deep:false};
  return {...snapshot,opticsRevision,transport:{majorants,...coefficients}};
}
