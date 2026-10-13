/** Each interpolation cell bounds the maximum of its eight cloud-density texels.
 * Edge cells use clamped sampling, exactly as the WebGL 3D texture does.
 */
export function cloudMajorants(data: Float32Array, dimensions: readonly [number,number,number],extinctionPerDensity=150000) {
  const [nx,ny,nz]=dimensions;
  const result=new Float32Array((nx+1)*(ny+1)*(nz+1));
  for (let z=0;z<=nz;z++) for (let y=0;y<=ny;y++) for (let x=0;x<=nx;x++) {
    let maximum=0;
    for (let dz=0;dz<2;dz++) for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++) {
      const ix=Math.max(0,Math.min(nx-1,x-1+dx));
      const iy=Math.max(0,Math.min(ny-1,y-1+dy));
      const iz=Math.max(0,Math.min(nz-1,z-1+dz));
      maximum=Math.max(maximum,data[(ix+nx*(iy+ny*iz))*4]);
    }
    result[x+(nx+1)*(y+(ny+1)*z)]=maximum*extinctionPerDensity*1.00001;
  }
  return result;
}
