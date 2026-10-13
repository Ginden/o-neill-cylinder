import { describe,expect,it } from 'vitest';
import { defaults } from '../src/settings';
import { directIllumination } from '../src/physics';
import { dot,glassPlate,glassReflectance,intersectMirror,mirrorGeometry,reflect,sunDirection,windowOpening } from '../src/optics';
import { cloudMajorants } from '../src/render/majorant';

describe('explicit solar optics',()=>{
  it('redirects one axial Sun according to each panel normal and deployment',()=>{
    const sun=sunDirection(defaults);
    for (const panel of mirrorGeometry(defaults)) {
      const direction=reflect(sun,panel.normal);
      expect(direction[2]).toBeCloseTo(0,10);
      expect(dot(direction,panel.across)).toBeCloseTo(0,10);
      expect(dot(direction,direction)).toBeCloseTo(1,10);
      expect(dot(direction,panel.normal)).toBeCloseTo(-dot(sun,panel.normal),10);
    }
    const tilted=mirrorGeometry({...defaults,mirrorTilt:15})[0];
    expect(reflect(sun,tilted.normal)[2]).toBeCloseTo(-0.5,10);
  });
  it('clips illumination to finite panels and rejects misses, parallel rays, and hits behind the ray',()=>{
    const panel=mirrorGeometry(defaults)[1];
    expect(intersectMirror([0,0,0],[0,1,0],panel)).toBeCloseTo(panel.center[1],8);
    expect(intersectMirror([panel.halfWidth+0.1,0,0],[0,1,0],panel)).toBe(Infinity);
    expect(intersectMirror([0,0,0],[0,-1,0],panel)).toBe(Infinity);
    expect(intersectMirror([0,0,0],panel.across,panel)).toBe(Infinity);
    expect(directIllumination([0,-3.5,0.5],defaults)).toBeGreaterThan(0.6);
    expect(directIllumination([0,-3.5,0.5],{...defaults,mirrorReflectivity:0})).toBe(0);
    expect(directIllumination([0,-3.5,0.5],{...defaults,sunElevation:-90})).toBe(0);
  });
  it('treats structural rings and window edges as occluders, not cosmetic lines',()=>{
    expect(windowOpening([0,4,0.5],defaults)).toBe(true);
    expect(windowOpening([0,4,0],defaults)).toBe(false);
    expect(windowOpening([0,4,12],defaults)).toBe(false);
    expect(windowOpening([0,-4,0.5],defaults)).toBe(false);
  });
  it('accounts for both glass interfaces and reduces transmission at grazing angles',()=>{
    const single=((1.52-1)/(1.52+1))**2;
    expect(glassReflectance(1)).toBeCloseTo(2*single/(1+single),10);
    expect(glassReflectance(0.1)).toBeGreaterThan(0.5);
    expect(glassReflectance(0)).toBeCloseTo(1,10);
    expect(glassReflectance(-0.1)).toBeCloseTo(glassReflectance(0.1),10);
    const opaque=glassPlate(1,0);
    expect(opaque.reflectance).toBeCloseTo(single,10); // Only the front interface survives.
    expect(opaque.transmission).toBe(0);
    const absorbing=glassPlate(1,0.8);
    expect(absorbing.reflectance+absorbing.transmission).toBeLessThan(1);
    expect(glassPlate(0.1,0.8).transmission).toBeLessThan(absorbing.transmission);
  });
});

describe('heterogeneous medium bounds',()=>{
  it('bounds every trilinear cell, including clamped edges and a narrow dense cloud',()=>{
    const n=3,data=new Float32Array(n*n*n*4);
    data[(1+n*(1+n))*4]=0.002;
    const bounds=cloudMajorants(data,[n,n,n]);
    for (let z=0;z<=n;z++) for (let y=0;y<=n;y++) for (let x=0;x<=n;x++) {
      let interpolated=0;
      for (let dz=0;dz<2;dz++) for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++) {
        const ix=Math.max(0,Math.min(n-1,x-1+dx)),iy=Math.max(0,Math.min(n-1,y-1+dy)),iz=Math.max(0,Math.min(n-1,z-1+dz));
        interpolated+=data[(ix+n*(iy+n*iz))*4]/8*150000;
      }
      expect(bounds[x+(n+1)*(y+(n+1)*z)]).toBeGreaterThanOrEqual(interpolated);
    }
    expect(bounds[1+4*(1+4)]).toBeGreaterThan(300);
    expect(bounds[0]).toBe(0);
  });
});
