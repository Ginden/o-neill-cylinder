/** Lorenz–Mie solution for homogeneous spheres (Bohren–Huffman recurrence).
 * Positive imaginary refractive index denotes absorption with outgoing Hankel h₁.
 * Distances must share units. No fitted Henyey–Greenstein phase function is used.
 */
type Complex=readonly [number,number];
const multiply=(a:Complex,b:Complex):Complex=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
const divide=(a:Complex,b:Complex):Complex=>{
  const denominator=b[0]*b[0]+b[1]*b[1];
  return [(a[0]*b[0]+a[1]*b[1])/denominator,(a[1]*b[0]-a[0]*b[1])/denominator];
};
const squared=(a:Complex)=>a[0]*a[0]+a[1]*a[1];

export function mieSphere(radius:number,wavelength:number,index:Complex) {
  const x=2*Math.PI*radius/wavelength;
  const terms=Math.ceil(x+4*Math.cbrt(x)+2);
  const stop=Math.ceil(Math.max(terms,x*Math.hypot(...index)))+20;
  const z:Complex=[x*index[0],x*index[1]];
  const derivatives:Complex[]=Array.from({length:stop+1},()=>[0,0]);
  for (let n=stop;n>0;n--) {
    const ratio=divide([n,0],z);
    const inverse=divide([1,0],[derivatives[n][0]+ratio[0],derivatives[n][1]+ratio[1]]);
    derivatives[n-1]=[ratio[0]-inverse[0],ratio[1]-inverse[1]];
  }
  let psiPrevious=Math.sin(x),psi=Math.sin(x)/x-Math.cos(x);
  let chiPrevious=Math.cos(x),chi=Math.cos(x)/x+Math.sin(x);
  const a:Complex[]=[],b:Complex[]=[];
  let scattering=0,extinction=0;
  for (let n=1;n<=terms;n++) {
    const da=divide(derivatives[n],index),db=multiply(derivatives[n],index);
    const coefficient=(d:Complex):Complex=>{
      const term:Complex=[d[0]+n/x,d[1]];
      const numerator:Complex=[term[0]*psi-psiPrevious,term[1]*psi];
      const product=multiply(term,[psi,-chi]);
      return divide(numerator,[product[0]-psiPrevious,product[1]+chiPrevious]);
    };
    const an=coefficient(da),bn=coefficient(db);
    a.push(an);b.push(bn);
    scattering+=(2*n+1)*(squared(an)+squared(bn));
    extinction+=(2*n+1)*(an[0]+bn[0]);
    const nextPsi=(2*n+1)/x*psi-psiPrevious,nextChi=(2*n+1)/x*chi-chiPrevious;
    psiPrevious=psi;psi=nextPsi;chiPrevious=chi;chi=nextChi;
  }
  const qScattering=2*scattering/(x*x),qExtinction=2*extinction/(x*x);
  function phase(cosine:number) {
    let piPrevious=0,pi=1;
    let s1r=0,s1i=0,s2r=0,s2i=0;
    for (let n=1;n<=terms;n++) {
      const tau=n*cosine*pi-(n+1)*piPrevious;
      const factor=(2*n+1)/(n*(n+1));
      s1r+=factor*(a[n-1][0]*pi+b[n-1][0]*tau);
      s1i+=factor*(a[n-1][1]*pi+b[n-1][1]*tau);
      s2r+=factor*(a[n-1][0]*tau+b[n-1][0]*pi);
      s2i+=factor*(a[n-1][1]*tau+b[n-1][1]*pi);
      const next=(2*n+1)/n*cosine*pi-(n+1)/n*piPrevious;
      piPrevious=pi;pi=next;
    }
    return (s1r*s1r+s1i*s1i+s2r*s2r+s2i*s2i)/(2*Math.PI*x*x*qScattering);
  }
  return {qScattering,qExtinction,phase};
}

export const PHASE_TABLE_SIZE=1024;
export const SPECTRAL_BINS=41;

/** Continuous-wavelength renderer interpolates extinction, scattering and phase
 * between 10 nm nodes. The sampled wavelength itself is uniform on 380–780 nm.
 */
export function particleOptics(effectiveRadius:number,logWidth:number,index:Complex) {
  return summarizeOptics(particleOpticsRows(effectiveRadius,logWidth,index,0,SPECTRAL_BINS));
}

export interface ParticleOptics {
  data: Float32Array;
  maximumExtinction: number;
  greenExtinction: number;
  /** Mean scattering cosine g at 550 nm, from the tabulated CDF. */
  greenAsymmetry: number;
}

/** Mean scattering cosine g of one wavelength row, from the tabulated CDF. */
export function asymmetry(data:Float32Array,bin:number) {
  let g=0;
  for(let j=1;j<PHASE_TABLE_SIZE;j++) {
    const offset=(j+bin*PHASE_TABLE_SIZE)*4,theta=Math.PI*((j-0.5)/(PHASE_TABLE_SIZE-1))**2;
    g+=Math.cos(theta)*(data[offset+1]-data[offset-3]);
  }
  return g;
}

export function summarizeOptics(data:Float32Array):ParticleOptics {
  let maximumExtinction=0;
  for(let bin=0;bin<SPECTRAL_BINS;bin++) maximumExtinction=Math.max(maximumExtinction,data[bin*PHASE_TABLE_SIZE*4+2]);
  return {data,maximumExtinction,greenExtinction:data[17*PHASE_TABLE_SIZE*4+2],greenAsymmetry:asymmetry(data,17)};
}

/** Wavelength rows are independent, so workers can calculate disjoint ranges. */
export function particleOpticsRows(effectiveRadius:number,logWidth:number,index:Complex,start:number,end:number) {
  const particles=Array.from({length:15},(_,i)=>{
    const z=-3.5+7*(i+0.5)/15;
    const radius=effectiveRadius*Math.exp(-2.5*logWidth*logWidth+z*logWidth);
    return {radius,weight:Math.exp(-z*z/2)};
  });
  const massMoment=particles.reduce((sum,p)=>sum+p.weight*p.radius**3,0);
  const data=new Float32Array(PHASE_TABLE_SIZE*(end-start)*4);
  for (let bin=start;bin<end;bin++) {
    const coefficients=particles.map(p=>mieSphere(p.radius,(380+10*bin)/1000,index));
    const scatteringArea=particles.reduce((sum,p,i)=>sum+p.weight*p.radius*p.radius*coefficients[i].qScattering,0);
    const extinctionArea=particles.reduce((sum,p,i)=>sum+p.weight*p.radius*p.radius*coefficients[i].qExtinction,0);
    const extinction=750000*extinctionArea/massMoment,scattering=750000*scatteringArea/massMoment;
    let integral=0,previous=0;
    for (let j=0;j<PHASE_TABLE_SIZE;j++) {
      const u=j/(PHASE_TABLE_SIZE-1),theta=Math.PI*u*u;
      const phase=particles.reduce((sum,p,i)=>sum+p.weight*p.radius*p.radius*coefficients[i].qScattering*coefficients[i].phase(Math.cos(theta)),0)/scatteringArea;
      const offset=(j+(bin-start)*PHASE_TABLE_SIZE)*4;
      data[offset]=phase;data[offset+2]=extinction;data[offset+3]=scattering;
      const integrand=phase*2*Math.PI*Math.sin(theta)*2*Math.PI*u;
      if (j>0) integral+=(integrand+previous)/2/(PHASE_TABLE_SIZE-1);
      data[offset+1]=integral;previous=integrand;
    }
    for (let j=0;j<PHASE_TABLE_SIZE;j++) {
      const offset=(j+(bin-start)*PHASE_TABLE_SIZE)*4;
      data[offset]/=integral;data[offset+1]/=integral;
    }
  }
  return data;
}
