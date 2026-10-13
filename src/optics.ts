import type { Settings } from './settings';

export type Vec3 = [number, number, number];
export const SOLAR_ANGULAR_RADIUS = Math.asin(695700 / 149597870.7);
export const GLASS_IOR = 1.52;
export const FRAME_WIDTH_KM = 0.01;
export const dot = (a: readonly number[], b: readonly number[]) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function reflect(d: readonly number[], n: readonly number[]): Vec3 {
  const scale = 2 * dot(d,n);
  return [d[0]-scale*n[0], d[1]-scale*n[1], d[2]-scale*n[2]];
}

export function sunDirection(s: Settings): Vec3 {
  const azimuth = s.sunAzimuth*Math.PI/180, elevation = s.sunElevation*Math.PI/180;
  return [Math.cos(azimuth)*Math.cos(elevation), Math.sin(azimuth)*Math.cos(elevation), Math.sin(elevation)];
}

/** Rectangular panels hinged at the anti-sunward end of each longitudinal window.
 * Their actual dimensions and deployment are independent of the Sun direction.
 */
export function mirrorGeometry(s: Settings) {
  const deployment = (45+s.mirrorTilt)*Math.PI/180;
  const halfLength = s.length/Math.SQRT2;
  const halfWidth = s.radius*Math.sin(Math.PI*s.windowFraction/3);
  return [-Math.PI/6, Math.PI/2, 7*Math.PI/6].map(angle => {
    const radial: Vec3 = [Math.cos(angle),Math.sin(angle),0];
    const across: Vec3 = [-radial[1],radial[0],0];
    const along: Vec3 = [radial[0]*Math.sin(deployment),radial[1]*Math.sin(deployment),Math.cos(deployment)];
    const normal: Vec3 = [radial[0]*Math.cos(deployment),radial[1]*Math.cos(deployment),-Math.sin(deployment)];
    const center: Vec3 = [radial[0]*s.radius+along[0]*halfLength,
      radial[1]*s.radius+along[1]*halfLength,-s.length/2+along[2]*halfLength];
    return { center, across, along, normal, halfWidth, halfLength };
  });
}

export function intersectMirror(p: readonly number[], d: readonly number[], panel: ReturnType<typeof mirrorGeometry>[number]) {
  const denominator = dot(d,panel.normal);
  if (Math.abs(denominator)<1e-10) return Infinity;
  const offset = panel.center.map((v,i)=>v-p[i]);
  const distance = dot(offset,panel.normal)/denominator;
  if (distance<=1e-5) return Infinity;
  const relative = p.map((v,i)=>v+d[i]*distance-panel.center[i]);
  return Math.abs(dot(relative,panel.across))<=panel.halfWidth && Math.abs(dot(relative,panel.along))<=panel.halfLength
    ? distance : Infinity;
}

/** Incoherent plane-parallel glass plate, including repeated internal reflection. */
export function glassPlate(cosine: number,bulkTransmission:number) {
  const c = Math.min(1,Math.abs(cosine));
  const ct = Math.sqrt(1-(1-c*c)/(GLASS_IOR*GLASS_IOR));
  const rs = (c-GLASS_IOR*ct)/(c+GLASS_IOR*ct);
  const rp = (GLASS_IOR*c-ct)/(GLASS_IOR*c+ct);
  const f = (rs*rs+rp*rp)/2;
  const attenuation=bulkTransmission**(1/ct);
  const denominator=Math.max(1e-12,1-f*f*attenuation*attenuation);
  return {reflectance:f+(1-f)**2*f*attenuation*attenuation/denominator,
    transmission:(1-f)**2*attenuation/denominator};
}

export function glassReflectance(cosine:number) {
  return glassPlate(cosine,1).reflectance;
}

export function windowOpening(p: readonly number[], s: Settings) {
  if (Math.abs(p[2])>=s.length/2-FRAME_WIDTH_KM/2) return false;
  const theta = Math.atan2(p[1],p[0]);
  const phase = (theta+Math.PI/2)/(2*Math.PI/3);
  const angularMargin = Math.abs(phase-Math.round(phase))-(1-s.windowFraction)/2;
  const ringDistance = Math.abs((p[2]+s.length/2)/1.5-Math.round((p[2]+s.length/2)/1.5))*1.5;
  return angularMargin*(2*Math.PI/3)*s.radius>FRAME_WIDTH_KM/2 && ringDistance>FRAME_WIDTH_KM/2;
}
