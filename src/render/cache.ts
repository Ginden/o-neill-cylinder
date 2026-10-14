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

/** The cylindrical cache and weather texture both scale with the habitat.
 * Their interpolation stencil depends only on the weather grid dimensions.
 * Store XY and Z separately: about 146 KiB instead of 18 MiB for eight full
 * indices and double-precision weights at every cache cell. */
function makeWeatherSampling(dimensions:WeatherField['dimensions']) {
  const [nx,ny,nz]=dimensions;
  const xyIndices=new Uint32Array(CACHE_RADIAL*CACHE_ANGULAR*4),xyWeights=new Float64Array(xyIndices.length);
  const zIndices=new Uint32Array(CACHE_AXIAL*2),zWeights=new Float64Array(zIndices.length);
  const coordinate=(value:number,n:number)=>Math.min(n-1,Math.max(0,value*n-0.5));
  for (let i=0;i<CACHE_RADIAL;i++) {
    const {outer,inner}=cacheRadii(i,1),r=(outer+inner)/2;
    for (let j=0;j<CACHE_ANGULAR;j++) {
      const theta=(j+0.5)/CACHE_ANGULAR*2*Math.PI;
      const gx=coordinate(r*Math.cos(theta)/2+0.5,nx),gy=coordinate(r*Math.sin(theta)/2+0.5,ny);
      const ix=Math.min(nx-2,Math.floor(gx)),iy=Math.min(ny-2,Math.floor(gy)),fx=gx-ix,fy=gy-iy;
      for (let y=0;y<2;y++) for (let x=0;x<2;x++) {
        const offset=(i*CACHE_ANGULAR+j)*4+y*2+x;
        xyIndices[offset]=((ix+x)+nx*(iy+y))*4;
        xyWeights[offset]=(x ? fx : 1-fx)*(y ? fy : 1-fy);
      }
    }
  }
  for (let k=0;k<CACHE_AXIAL;k++) {
    const gz=coordinate((k+0.5)/CACHE_AXIAL,nz),iz=Math.min(nz-2,Math.floor(gz)),fz=gz-iz;
    for (let z=0;z<2;z++) {
      zIndices[k*2+z]=(iz+z)*nx*ny*4;
      zWeights[k*2+z]=z ? fz : 1-fz;
    }
  }
  return {dimensions:[nx,ny,nz],xyIndices,xyWeights,zIndices,zWeights};
}
let weatherSampling:ReturnType<typeof makeWeatherSampling>|undefined;

/** Liquid water (kg/m³), trilinear like the GPU's clamped linear texture. */
function liquidAt(data:Float32Array,sampling:ReturnType<typeof makeWeatherSampling>,xy:number,z:number) {
  const {xyIndices,xyWeights,zIndices,zWeights}=sampling;
  let value=0;
  for (let k=0;k<2;k++) for (let j=0;j<4;j++) {
    value+=xyWeights[xy*4+j]*zWeights[z*2+k]*data[xyIndices[xy*4+j]+zIndices[z*2+k]];
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
  let sampling:typeof weatherSampling;
  if (weather && s.clouds) {
    if (!weatherSampling || weather.dimensions.some((n,i)=>n!==weatherSampling!.dimensions[i])) {
      weatherSampling=makeWeatherSampling(weather.dimensions);
    }
    sampling=weatherSampling;
  }
  const cloudAbsorption=cloud.map(c=>c.extinction-c.scattering);
  const cloudScattering=cloud.map(c=>c.scattering*(1-c.g));
  const airAbsorption=new Float64Array(4),airScattering=new Float64Array(4);
  const thick=new Uint8Array(cells);
  const index=(i:number,j:number,k:number)=>j+CACHE_ANGULAR*(i+CACHE_RADIAL*k);
  for (let i=0;i<CACHE_RADIAL;i++) {
    const {outer,inner}=cacheRadii(i,s.radius),r=(outer+inner)/2;
    const b=backgroundAt(r,s),density=b.pressure/101325*288.15/b.temperature;
    for (let n=0;n<4;n++) {
      const a=aerosol[n];
      airAbsorption[n]=(a.extinction-a.scattering)*aerosolScale*density;
      airScattering[n]=rayleigh[n]*density+a.scattering*aerosolScale*density*(1-a.g);
    }
    for (let k=0;k<CACHE_AXIAL;k++) for (let j=0;j<CACHE_ANGULAR;j++) {
      const liquid=sampling && weather ? liquidAt(weather.data,sampling,i*CACHE_ANGULAR+j,k) : 0;
      const cell=index(i,j,k);
      let minimum=Infinity;
      for (let n=0;n<4;n++) {
        const sigmaA=airAbsorption[n]+cloudAbsorption[n]*liquid;
        const transport=Math.max(1e-6,sigmaA+airScattering[n]+cloudScattering[n]*liquid);
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
      const cell=index(i,j,k);
      if (!thick[cell] || !thick[cell-CACHE_ANGULAR]
        || !thick[index(i,(j+1)%CACHE_ANGULAR,k)] || !thick[index(i,(j+CACHE_ANGULAR-1)%CACHE_ANGULAR,k)]
        || !thick[cell-CACHE_ANGULAR*CACHE_RADIAL] || !thick[cell+CACHE_ANGULAR*CACHE_RADIAL]
        || (i<CACHE_RADIAL-1 && !thick[cell+CACHE_ANGULAR])) continue;
      for (let n=0;n<4;n++) diffusion[cell*4+n]=-diffusion[cell*4+n];
    }
  }
  return {diffusion,absorption};
}
