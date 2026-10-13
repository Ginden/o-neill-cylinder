import { SOLAR_ANGULAR_RADIUS } from '../optics';

// CIE 1931 2° matching-function fits: Wyman, Sloan & Shirley (JCGT 2013).
export function cieXYZ(lambda:number) {
  const gaussian=(center:number,left:number,right:number)=>{
    const t=(lambda-center)*(lambda<center ? left : right);
    return Math.exp(-0.5*t*t);
  };
  return [0.362*gaussian(442,0.0624,0.0374)+1.056*gaussian(599.8,0.0264,0.0323)-0.065*gaussian(501.1,0.049,0.0382),
    0.821*gaussian(568.8,0.0213,0.0247)+0.286*gaussian(530.9,0.0613,0.0322),
    1.217*gaussian(437,0.0845,0.0278)+0.681*gaussian(459,0.0385,0.0725)];
}

/** Planck radiance in W m⁻² sr⁻¹ nm⁻¹. */
export function blackbody(lambdaNm:number,temperature:number) {
  const lambda=lambdaNm*1e-9;
  return 1.191042972e-16/(lambda**5*Math.expm1(0.01438776877/(lambda*temperature)))*1e-9;
}

export const SOLAR_TEMPERATURE=5772;
export const SOLAR_IRRADIANCE_SOLID_ANGLE=Math.PI*Math.sin(SOLAR_ANGULAR_RADIUS)**2;
export const SOLAR_ILLUMINANCE=Array.from({length:401},(_,i)=>{
  const lambda=380+i;
  return 683*cieXYZ(lambda)[1]*blackbody(lambda,SOLAR_TEMPERATURE)*SOLAR_IRRADIANCE_SOLID_ANGLE;
}).reduce((sum,value)=>sum+value,0);
export const LAMP_RADIANCE_SCALE=2/Array.from({length:401},(_,i)=>{
  const lambda=380+i;return 683*cieXYZ(lambda)[1]*blackbody(lambda,2800);
}).reduce((sum,value)=>sum+value,0); // 2 cd/m² emitting patch.
