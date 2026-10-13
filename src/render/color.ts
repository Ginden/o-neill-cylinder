import { Matrix3,Vector3 } from 'three';
import { blackbody,cieXYZ,SOLAR_TEMPERATURE } from './solar';

/** Integrate the renderer's 440/550/680 nm reflectance basis under its Sun.
 * The raster preview must not interpret these spectral anchors as sRGB. */
const columns = [new Vector3(),new Vector3(),new Vector3()];
let normalization=0;
for(let wavelength=380;wavelength<=780;wavelength++) {
  const xyz=new Vector3(...cieXYZ(wavelength)).multiplyScalar(blackbody(wavelength,SOLAR_TEMPERATURE));
  const t=wavelength<550 ? Math.max(0,(wavelength-440)/110) : Math.min(1,(wavelength-550)/130);
  const basis=wavelength<550 ? [0,t,1-t] : [t,1-t,0];
  columns.forEach((column,i)=>column.addScaledVector(xyz,basis[i]));
  normalization+=xyz.y;
}
columns.forEach(column=>column.divideScalar(normalization));
export const MATERIAL_XYZ=new Matrix3().set(
  columns[0].x,columns[1].x,columns[2].x,
  columns[0].y,columns[1].y,columns[2].y,
  columns[0].z,columns[1].z,columns[2].z);

// Bradford chromatic adaptation from the simulated solar white to display D65.
const bradford=new Matrix3().set(0.8951,0.2664,-0.1614,-0.7502,1.7135,0.0367,0.0389,-0.0685,1.0296);
const source=new Vector3(1,1,1).applyMatrix3(MATERIAL_XYZ).applyMatrix3(bradford);
const destination=new Vector3(0.95047,1,1.08883).applyMatrix3(bradford);
export const SOLAR_WHITE_BALANCE=bradford.clone().invert().multiply(new Matrix3().set(
  destination.x/source.x,0,0,0,destination.y/source.y,0,0,0,destination.z/source.z)).multiply(bradford);

// The preview uses the same 2800 K, 2 cd/m² lamp source as the tracer.
export const LAMP_XYZ=new Vector3();
for(let wavelength=380;wavelength<=780;wavelength++)
  LAMP_XYZ.add(new Vector3(...cieXYZ(wavelength)).multiplyScalar(blackbody(wavelength,2800)));
LAMP_XYZ.multiplyScalar(2/LAMP_XYZ.y);
