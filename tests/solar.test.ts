import { expect,it } from 'vitest';
import { blackbody,cieXYZ,SOLAR_IRRADIANCE_SOLID_ANGLE,SOLAR_ILLUMINANCE,SOLAR_TEMPERATURE } from '../src/render/solar';

it('integrates the solar spectrum to the nominal 1 au bolometric irradiance',()=>{
  let integral=0,previous=0;
  const bins=10000,lo=Math.log(1),hi=Math.log(1e7),step=(hi-lo)/bins;
  for (let i=0;i<=bins;i++) {
    const lambda=Math.exp(lo+i*step);
    const integrand=blackbody(lambda,SOLAR_TEMPERATURE)*lambda;
    if (i>0) integral+=(integrand+previous)*step/2;
    previous=integrand;
  }
  expect(integral*SOLAR_IRRADIANCE_SOLID_ANGLE).toBeGreaterThan(1350);
  expect(integral*SOLAR_IRRADIANCE_SOLID_ANGLE).toBeLessThan(1370);
});

it('keeps the photopic response anchored to the CIE peak and plausible extraterrestrial illuminance',()=>{
  expect(cieXYZ(555)[1]).toBeCloseTo(1,2);
  expect(cieXYZ(380)[1]).toBeLessThan(0.001);
  expect(SOLAR_ILLUMINANCE).toBeGreaterThan(100000);
  expect(SOLAR_ILLUMINANCE).toBeLessThan(150000);
});
