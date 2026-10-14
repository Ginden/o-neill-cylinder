/** Independent ray-energy walk through both interfaces, preserving s/p within
 * a plate. Unlike production's closed form, each internal bounce is explicit. */
export function plateReference(angleDegrees:number,bulk:number,index:number) {
  if (angleDegrees===90) return {reflectance:1,transmission:0};
  const angle=angleDegrees*Math.PI/180,refracted=Math.asin(Math.sin(angle)/index);
  const fresnel=angleDegrees===0 ? [((index-1)/(index+1))**2,((index-1)/(index+1))**2] :
    [(Math.sin(angle-refracted)/Math.sin(angle+refracted))**2,
      (Math.tan(angle-refracted)/Math.tan(angle+refracted))**2];
  const attenuation=bulk**(1/Math.cos(refracted));
  let reflectance=0,transmission=0;
  for (const f of fresnel) {
    reflectance+=f/2;
    let inside=(1-f)/2,front=false;
    while (inside>1e-14) {
      inside*=attenuation;
      const escaping=inside*(1-f);
      if (front) reflectance+=escaping;
      else transmission+=escaping;
      inside*=f;front=!front;
    }
  }
  return {reflectance,transmission};
}
