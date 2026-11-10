/// <reference lib="webworker" />
import type { Settings } from '../settings';
import { WeatherSolver } from './solver';
import type { CacheOptics } from '../render/cache';
import { prepareWeather } from './transport';

let solver:WeatherSolver;
let settings:Settings;
let optics:CacheOptics|undefined;
let revision=0,opticsRevision=0;

self.onmessage=(event:MessageEvent<
  {type:'reset';settings:Settings;revision:number}
  | {type:'step';dt:number;revision:number}
  | {type:'transport';settings:Settings;optics?:CacheOptics;opticsRevision:number;revision:number}
>)=>{
  const message=event.data;
  if (message.type==='reset') {
    revision=message.revision;settings=message.settings;
    solver=new WeatherSolver(settings);
    return; // A reset is followed by the matching optical configuration.
  } else {
    if (message.revision!==revision) return;
    if (message.type==='transport') {
      settings=message.settings;optics=message.optics ?? optics;opticsRevision=message.opticsRevision;
    } else {
      let remaining=message.dt;
      while (remaining>0.001) remaining-=solver.step(remaining);
    }
  }
  // Initial weather can solve while particle tables are being prepared. Its
  // first usable snapshot follows the compact optical configuration.
  if (!optics) return;
  const snapshot=prepareWeather({...solver.snapshot(),revision},settings,optics,opticsRevision);
  const transfer=[snapshot.data.buffer,snapshot.transport.majorants.buffer];
  if (snapshot.transport.diffusion) transfer.push(snapshot.transport.diffusion.buffer,snapshot.transport.absorption!.buffer);
  self.postMessage(snapshot,{transfer:transfer as ArrayBuffer[]});
};
