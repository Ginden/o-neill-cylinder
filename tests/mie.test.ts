import { describe,expect,it } from 'vitest';
import { mieSphere,particleOptics,PHASE_TABLE_SIZE,SPECTRAL_BINS } from '../src/render/mie';

describe('Lorenz–Mie scattering',()=>{
  it('matches independently published miepython efficiency reference cases',()=>{
    // Prahl's algorithm notebook, examples [7] and [5]; our Im(n) sign is opposite.
    const sphere=mieSphere(0.525,0.6328,[1.55,0]);
    expect(sphere.qExtinction).toBeCloseTo(3.1054255,6);
    expect(sphere.qScattering).toBeCloseTo(3.1054255,6);
    const small=mieSphere(0.067/(2*Math.PI),1,[1.5,0.1]);
    expect(small.qExtinction).toBeCloseTo(0.0133882,6);
    expect(small.qScattering).toBeCloseTo(0.0000048,6);
  });
  it('converges to the analytical Rayleigh cross-section and phase for small spheres',()=>{
    const radius=0.001,wavelength=0.55,index=1.5;
    const x=2*Math.PI*radius/wavelength;
    const analytic=8/3*x**4*((index**2-1)/(index**2+2))**2;
    const result=mieSphere(radius,wavelength,[index,0]);
    expect(result.qScattering/analytic).toBeCloseTo(1,3);
    expect(result.qExtinction/result.qScattering).toBeCloseTo(1,8);
    expect(result.phase(0)).toBeCloseTo(3/(16*Math.PI),4);
    expect(result.phase(1)).toBeCloseTo(3/(8*Math.PI),3);
  });
  it('conserves energy for water droplets and includes absorption for lossy aerosols',()=>{
    const water=mieSphere(10,0.55,[1.333,0]);
    expect(water.qExtinction).toBeGreaterThan(1);
    expect(water.qExtinction).toBeLessThan(3);
    expect(water.qScattering).toBeCloseTo(water.qExtinction,8);
    const absorbing=mieSphere(0.15,0.55,[1.5,0.01]);
    expect(absorbing.qExtinction).toBeGreaterThan(absorbing.qScattering);
    expect(absorbing.qScattering).toBeGreaterThan(0);
  });
  it('normalizes the polydisperse phase integral and creates a monotonic inverse-sampling CDF',()=>{
    const population=particleOptics(10,0.35,[1.333,0]);
    expect(population.greenExtinction).toBeGreaterThan(120000);
    expect(population.greenExtinction).toBeLessThan(190000);
    for (const bin of [0,17,SPECTRAL_BINS-1]) {
      let sum=0,previous=0;
      const row=bin*PHASE_TABLE_SIZE;
      for (let i=0;i<PHASE_TABLE_SIZE;i++) {
        const u=i/(PHASE_TABLE_SIZE-1),theta=Math.PI*u*u;
        const integrand=population.data[(row+i)*4]*2*Math.PI*Math.sin(theta)*2*Math.PI*u;
        if (i>0) sum+=(previous+integrand)/2/(PHASE_TABLE_SIZE-1);
        previous=integrand;
        if (i>0) expect(population.data[(row+i)*4+1]).toBeGreaterThanOrEqual(population.data[(row+i-1)*4+1]);
      }
      expect(sum).toBeCloseTo(1,5);
      expect(population.data[(row+PHASE_TABLE_SIZE-1)*4+1]).toBeCloseTo(1,6);
    }
  });
});
