import { afterEach, expect, it, vi } from 'vitest';
import { WeatherClient } from '../src/weather/client';
import type { WeatherSnapshot } from '../src/weather/client';
import { defaults } from '../src/settings';

class WeatherWorker {
  static current: WeatherWorker;
  onmessage!: (event: {data:WeatherSnapshot}) => void;
  requests: {type:string;dt?:number;revision:number}[] = [];
  constructor() { WeatherWorker.current=this; }
  postMessage(message: {type:string;dt?:number;revision:number}) {this.requests.push(message);}
  terminate() {}
  report(seconds: number, revision=1) {
    this.onmessage({data:{ data:new Float32Array(1),dimensions:[1,1,1],revision,
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
