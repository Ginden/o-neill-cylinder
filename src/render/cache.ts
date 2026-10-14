import type { Settings } from '../settings';
import { backgroundAt, rayleighPerKm } from '../physics';
import { asymmetry, PHASE_TABLE_SIZE } from './mie';
import type { ParticleOptics } from './mie';

/** Scattered-light cache grid (cache.glsl): radial × angular × axial cells.
 * Radial bins are uniform in sqrt(depth below the wall). The atlas stores
 * angular columns and radial-major axial rows. */
export const CACHE_RADIAL=32,CACHE_ANGULAR=96,CACHE_AXIAL=64;
export const CACHE_WAVELENGTHS=[400,500,600,700] as const;
/** Diffusion cells need a transport mean free path of at most 200 m. */
export const DEEP_TRANSPORT=5;
// Terrain stays below 1.84 × relief (landscape.glsl); crowns and roofs reach 40 m above it.
const TERRAIN_BOUND=1.84,CANOPY_TOP=0.04;

/** Outer and inner radius (km) of radial bin i. */
export function cacheRadii(i:number,radius:number) {
  return {outer:radius*(1-(i/CACHE_RADIAL)**2),inner:radius*(1-((i+1)/CACHE_RADIAL)**2)};
}

export interface WeatherField {data:Float32Array;dimensions:readonly [number,number,number]}

/** Liquid water (kg/m³) at a point (km), trilinear like the GPU's clamped linear texture. */
function liquidAt(weather:WeatherField,s:Settings,x:number,y:number,z:number) {
  const [nx,ny,nz]=weather.dimensions;
  const coordinate=(value:number,n:number)=>Math.min(n-1,Math.max(0,value*n-0.5));
  const gx=coordinate(x/(2*s.radius)+0.5,nx),gy=coordinate(y/(2*s.radius)+0.5,ny),gz=coordinate(z/s.length+0.5,nz);
  const ix=Math.min(nx-2,Math.floor(gx)),iy=Math.min(ny-2,Math.floor(gy)),iz=Math.min(nz-2,Math.floor(gz));
  const fx=gx-ix,fy=gy-iy,fz=gz-iz;
  let value=0;
  for (let k=0;k<2;k++) for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
    const w=(i ? fx : 1-fx)*(j ? fy : 1-fy)*(k ? fz : 1-fz);
    value+=w*weather.data[((ix+i)+nx*((iy+j)+ny*(iz+k)))*4];
  }
  return value;
}

/** Per-cell diffusion coefficient D = 1/(3σ_tr) (km) and absorption σ_a (1/km)
 * at the four node wavelengths, in the cache atlas layout. D is positive in
 * deep cells, where the diffusion equation replaces transport: σ_tr ≥ 5/km
 * there and in all six neighbors, away from terrain, windows and endcaps.
 * Elsewhere D is stored negated for neighboring deep cells. */
export function diffusionCells(weather:WeatherField|undefined,s:Settings,populations:[ParticleOptics,ParticleOptics]) {
  const cells=CACHE_RADIAL*CACHE_ANGULAR*CACHE_AXIAL;
  const diffusion=new Float32Array(cells*4),absorption=new Float32Array(cells*4);
  const bins=CACHE_WAVELENGTHS.map(lambda=>(lambda-380)/10);
  const row=(optics:ParticleOptics,bin:number)=>({extinction:optics.data[bin*PHASE_TABLE_SIZE*4+2],scattering:optics.data[bin*PHASE_TABLE_SIZE*4+3],g:asymmetry(optics.data,bin)});
  const aerosolScale=s.aerosol/populations[0].greenExtinction;
  const aerosol=bins.map(bin=>row(populations[0],bin)),cloud=bins.map(bin=>row(populations[1],bin));
  const rayleigh=CACHE_WAVELENGTHS.map(rayleighPerKm);
  const thick=new Uint8Array(cells);
  const index=(i:number,j:number,k:number)=>j+CACHE_ANGULAR*(i+CACHE_RADIAL*k);
  for (let i=0;i<CACHE_RADIAL;i++) {
    const {outer,inner}=cacheRadii(i,s.radius),r=(outer+inner)/2;
    const b=backgroundAt(r,s),density=b.pressure/101325*288.15/b.temperature;
    for (let k=0;k<CACHE_AXIAL;k++) for (let j=0;j<CACHE_ANGULAR;j++) {
      const theta=(j+0.5)/CACHE_ANGULAR*2*Math.PI,z=((k+0.5)/CACHE_AXIAL-0.5)*s.length;
      const liquid=weather && s.clouds ? liquidAt(weather,s,r*Math.cos(theta),r*Math.sin(theta),z) : 0;
      const cell=index(i,j,k);
      let minimum=Infinity;
      for (let n=0;n<4;n++) {
        const a=aerosol[n],c=cloud[n];
        const aerosolScattering=a.scattering*aerosolScale*density,cloudScattering=c.scattering*liquid;
        const sigmaA=(a.extinction-a.scattering)*aerosolScale*density+(c.extinction-c.scattering)*liquid;
        const transport=Math.max(1e-6,sigmaA+rayleigh[n]*density+aerosolScattering*(1-a.g)+cloudScattering*(1-c.g));
        diffusion[cell*4+n]=-1/(3*transport);absorption[cell*4+n]=Math.max(0,sigmaA);
        minimum=Math.min(minimum,transport);
      }
      thick[cell]=minimum>=DEEP_TRANSPORT ? 1 : 0;
    }
  }
  // The outer neighbor must also stay clear of terrain and land-use objects.
  const clearance=s.radius-TERRAIN_BOUND*s.terrainHeight-CANOPY_TOP;
  for (let i=1;i<CACHE_RADIAL;i++) {
    if (cacheRadii(i-1,s.radius).outer>=clearance) continue;
    for (let k=1;k<CACHE_AXIAL-1;k++) for (let j=0;j<CACHE_ANGULAR;j++) {
      const neighbors=[index(i,j,k),index(i-1,j,k),index(i,(j+1)%CACHE_ANGULAR,k),index(i,(j+CACHE_ANGULAR-1)%CACHE_ANGULAR,k),index(i,j,k-1),index(i,j,k+1)];
      if (i<CACHE_RADIAL-1) neighbors.push(index(i+1,j,k));
      if (neighbors.every(n=>thick[n])) {
        const cell=index(i,j,k);
        for (let n=0;n<4;n++) diffusion[cell*4+n]=-diffusion[cell*4+n];
      }
    }
  }
  return {diffusion,absorption};
}
