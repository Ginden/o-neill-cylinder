import { expect, test } from '@playwright/test';
import type { PreparedWeatherSnapshot } from '../../src/weather/transport';
import { openIsolatedPage } from './isolated';

// No renderer draws are needed here: the actual worker produces transferable
// coefficients, and setWeather merely attaches their arrays to GPU textures.
test('weather worker prepares matching optics and renderer installs fields without rebuilding them', async ({ page }) => {
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const settingsModule='/src/settings.ts',cacheModule='/src/render/cache.ts',mieModule='/src/render/mie.ts';
    const rendererModule='/src/render/renderer.ts',weatherModule='/src/weather/client.ts';
    const {defaults}=await import(settingsModule),{cacheOptics,diffusionFromOptics}=await import(cacheModule),{particleOptics}=await import(mieModule);
    const {HabitatRenderer}=await import(rendererModule),{WeatherClient}=await import(weatherModule);
    const populations=[particleOptics(defaults.aerosolRadius,0.35,[1.5,0.01]),particleOptics(defaults.cloudRadius,0.35,[1.333,1e-9])];
    const optics=cacheOptics(populations),settings={...defaults,clouds:true,humidity:100,terrainHeight:0,paused:true};
    const pending:((snapshot:PreparedWeatherSnapshot)=>void)[]=[];
    const client=new WeatherClient(settings,(snapshot:PreparedWeatherSnapshot)=>pending.shift()!(snapshot));
    const next=(change:()=>void)=>new Promise<PreparedWeatherSnapshot>(resolve=>{pending.push(resolve);change();});
    const first=await next(()=>client.configure(settings,optics));
    const serial=diffusionFromOptics(first,settings,optics);
    let maximumDifference=0;
    for(let i=0;i<serial.diffusion.length;i++) maximumDifference=Math.max(maximumDifference,Math.abs(serial.diffusion[i]-first.transport.diffusion![i]),Math.abs(serial.absorption[i]-first.transport.absorption![i]));
    const habitat=new HabitatRenderer(document.createElement('canvas'),settings,populations);
    habitat.setWeather(first);habitat.updateDiffusion();
    const originalTexture=habitat.material.uniforms.uCloudMajorant.value;
    const times:number[]=[];
    for(let i=0;i<24;i++) {
      const start=performance.now();habitat.setWeather(first);habitat.updateDiffusion();times.push(performance.now()-start);
    }
    const reusedTexture=habitat.material.uniforms.uCloudMajorant.value===originalTexture;
    const attached=originalTexture.image.data===first.transport.majorants && habitat.diffusionTextures[0].image.data===first.transport.diffusion;
    const changed={...settings,aerosol:0.1};
    const updated=await next(()=>client.configure(changed,optics));
    const newSerial=diffusionFromOptics(updated,changed,optics);
    let updatedDifference=0;
    for(let i=0;i<newSerial.absorption.length;i++) updatedDifference=Math.max(updatedDifference,Math.abs(newSerial.absorption[i]-updated.transport.absorption![i]));
    const vacuum={...settings,pressure:0};
    const nonScattering=await next(()=>client.configure(vacuum,optics));
    const skipVacuum=nonScattering.stats.cloudMass>0 && nonScattering.transport.diffusion===undefined;
    const dry={...settings,humidity:0};
    const empty=await next(()=>{client.reset(dry);client.configure(dry,optics);});
    const skipEmpty=empty.stats.cloudMass===0 && empty.transport.diffusion===undefined && !empty.transport.deep;
    const deep=first.transport.deep;
    const serialDeep=serial.diffusion.some((value:number)=>value>0);
    client.dispose();habitat.dispose();times.sort((a,b)=>a-b);
    return {maximumDifference,updatedDifference,deep,serialDeep,reusedTexture,attached,skipEmpty,skipVacuum,medianInstallMs:times[12],maxInstallMs:Math.max(...times)};
  });
  await test.info().attach('weather-install',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.maximumDifference).toBe(0);
  expect(result.updatedDifference).toBe(0);
  expect(result.deep).toBe(result.serialDeep);
  expect(result.deep).toBe(true);
  expect(result.reusedTexture).toBe(true);
  expect(result.attached).toBe(true);
  expect(result.skipEmpty).toBe(true);
  expect(result.skipVacuum).toBe(true);
  expect(result.medianInstallMs).toBeLessThan(2);
});
