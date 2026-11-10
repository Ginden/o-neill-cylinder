import { afterEach, expect, it, vi } from 'vitest';
import { WeatherClient } from '../src/weather/client';
import type { WeatherSnapshot } from '../src/weather/client';
import type { CacheOptics } from '../src/render/cache';
import { defaults } from '../src/settings';

class WeatherWorker {
  static current: WeatherWorker;
  onmessage!: (event: {data:WeatherSnapshot}) => void;
  requests: {type:string;dt?:number;revision:number;optics?:CacheOptics;opticsRevision?:number}[] = [];
  constructor() { WeatherWorker.current=this; }
  postMessage(message: {type:string;dt?:number;revision:number;optics?:CacheOptics;opticsRevision?:number}) {this.requests.push(message);}
  terminate() {}
  report(seconds: number, revision=1,opticsRevision=0) {
    this.onmessage({data:{ data:new Float32Array(1),dimensions:[1,1,1],revision,opticsRevision,transport:{majorants:new Float32Array(8),deep:false},
      stats:{seconds,achievedSpeed:0,maxWind:0,cloudMass:0,cloudFraction:0,maxTemperatureAnomaly:0} }});
  }
}
afterEach(() => vi.unstubAllGlobals());

it('reports elapsed simulation rather than the requested speed when the worker falls behind', () => {
  vi.stubGlobal('Worker',WeatherWorker);
  const settings={...defaults,clouds:true,paused:false,timeScale:600};
  let received:WeatherSnapshot|undefined;
  const client=new WeatherClient(settings,snapshot=>{received=snapshot;}),worker=WeatherWorker.current;
  worker.report(0);
  client.update(0.2,settings);
  expect(worker.requests.at(-1)?.dt).toBeCloseTo(120);
  client.update(2,settings); // Worker is busy: active real time continues to pass.
  worker.report(30);
  expect(client.stats.achievedSpeed).toBeCloseTo(30/2.2);
  expect(client.stats.seconds).toBe(30);
  expect(received?.stats.achievedSpeed).toBeCloseTo(30/2.2);
  // Pausing must not make the next active interval appear slower.
  client.update(100,{...settings,paused:true});
  client.update(0.2,settings);worker.report(50);
  expect(client.stats.achievedSpeed).toBeCloseTo(100);
  client.reset(settings);
  worker.report(1000,1); // A stale response cannot leak into the new run.
  expect(client.stats.achievedSpeed).toBe(0);
  expect(client.stats.seconds).toBe(50);
  worker.report(0,2);
  expect(client.stats.seconds).toBe(0);
  client.dispose();
});


it('waits for matching optical fields and resends particle summaries only when radii change', () => {
  vi.stubGlobal('Worker',WeatherWorker);
  const nodes=Array.from({length:4},()=>({extinction:2,scattering:1,g:0.5}));
  const optics:CacheOptics={aerosol:nodes,cloud:nodes,aerosolGreenExtinction:2,cloudMaximumExtinction:2};
  const settings={...defaults,clouds:true,paused:true};
  const client=new WeatherClient(settings,()=>{}),worker=WeatherWorker.current;
  client.configure(settings,optics);
  expect(worker.requests.at(-1)?.optics).toEqual(optics);
  expect(client.matches(settings)).toBe(false);
  worker.report(0,1,1);
  expect(client.matches(settings)).toBe(true);
  expect(client.configure({...settings,exposure:2,paused:false,timeScale:600},optics)).toBe(false);
  const vacuum={...settings,pressure:0};
  client.configure(vacuum,optics);
  expect(worker.requests.at(-1)?.optics).toBeUndefined();
  worker.report(300,1,1);
  expect(client.stats.seconds).toBe(0);
  expect(client.matches(vacuum)).toBe(false);
  worker.report(0,1,2);
  expect(client.matches(vacuum)).toBe(true);
  expect(client.matches(settings)).toBe(false);
  const changed={...vacuum,cloudRadius:20},newOptics={...optics,cloudMaximumExtinction:3};
  client.configure(changed,newOptics);
  expect(worker.requests.at(-1)?.optics).toEqual(newOptics);
  worker.report(0,1,3);
  expect(client.matches(changed)).toBe(true);
  client.dispose();
});
