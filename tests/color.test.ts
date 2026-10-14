import { expect,it } from 'vitest';
import { MATERIAL_XYZ,SOLAR_BANDS } from '../src/render/color';
import { blackbody,cieXYZ,SOLAR_IRRADIANCE_SOLID_ANGLE,SOLAR_TEMPERATURE } from '../src/render/solar';

it('gives the preview exact luminance for scattered light of any spectrum',()=>{
  // Blue skylight on a leaf-like surface (680, 550, 440 nm reflectances).
  const anchors=[0.08,0.4,0.03];
  const sky=(lambda:number)=>blackbody(lambda,SOLAR_TEMPERATURE)*SOLAR_IRRADIANCE_SOLID_ANGLE*0.2*(550/lambda)**4;
  let exact=0,sunlight=0;
  const bands=[0,0,0];
  for (let lambda=380;lambda<=780;lambda++) {
    const t=lambda<550 ? Math.max(0,(lambda-440)/110) : Math.min(1,(lambda-550)/130);
    const basis=lambda<550 ? [0,t,1-t] : [t,1-t,0];
    const y=cieXYZ(lambda)[1];
    exact+=y*sky(lambda)*basis.reduce((sum,b,i)=>sum+b*anchors[i],0);
    sunlight+=y*blackbody(lambda,SOLAR_TEMPERATURE)*SOLAR_IRRADIANCE_SOLID_ANGLE;
    basis.forEach((b,i)=>{bands[i]+=y*sky(lambda)*b;});
  }
  // What the surface pass stores, and how the preview shades it.
  const relative=bands.map((band,i)=>band/SOLAR_BANDS.getComponent(i));
  const row=MATERIAL_XYZ.elements;
  const preview=[0,1,2].reduce((sum,i)=>sum+row[1+3*i]*anchors[i]*relative[i],0);
  expect((SOLAR_BANDS.x+SOLAR_BANDS.y+SOLAR_BANDS.z)/sunlight).toBeCloseTo(1,10);
  expect(preview/(exact/sunlight)).toBeCloseTo(1,10);
});
