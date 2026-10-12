import { describe, expect, it } from 'vitest';
import { defaults } from '../src/settings';
import {
  angularVelocity, backgroundAt, boundaryDistance, directIllumination,
  equilibrate, HEAT_CAPACITY, isWindow, LATENT_HEAT, saturationMixingRatio
} from '../src/physics';

describe('centrifugal atmosphere', () => {
  it('satisfies hydrostatic balance throughout a non-isothermal cylinder', () => {
    const omega = angularVelocity(defaults);
    for (const r of [0.2, 1, 2, 3.8]) {
      const dr = 0.0001;
      const gradient = (backgroundAt(r+dr,defaults).pressure-backgroundAt(r-dr,defaults).pressure)/(dr*2000);
      const outwardForce = backgroundAt(r,defaults).density * omega**2 * r*1000;
      expect(gradient).toBeCloseTo(outwardForce, 5);
    }
  });
  it('retains substantial axis pressure at 1g but becomes uniform without rotation', () => {
    const isothermal = { ...defaults, lapseRate: 0, temperature: 14.85 };
    const ratio = backgroundAt(0,isothermal).pressure / backgroundAt(4,isothermal).pressure;
    expect(ratio).toBeCloseTo(0.7888, 3);
    expect(backgroundAt(0,{ ...isothermal,gravity:0 }).pressure).toBeCloseTo(defaults.pressure*100, 5);
    expect(backgroundAt(0,{ ...defaults,pressure:0 }).density).toBe(0);
  });
});

describe('moist thermodynamics', () => {
  it('condenses supersaturation while conserving water and moist enthalpy', () => {
    const t = 293.15, q = 0.03, pressure = 101325;
    const result = equilibrate(t,q,0,pressure);
    expect(result.cloud).toBeGreaterThan(0.001);
    expect(result.temperature).toBeGreaterThan(t+5);
    expect(result.vapor+result.cloud).toBeCloseTo(q, 10);
    expect(HEAT_CAPACITY*result.temperature+LATENT_HEAT*result.vapor).toBeCloseTo(HEAT_CAPACITY*t+LATENT_HEAT*q, 5);
    expect(result.vapor).toBeCloseTo(saturationMixingRatio(result.temperature,pressure), 7);
  });
  it('evaporates cloud into dry air and cools the parcel', () => {
    const result = equilibrate(293.15,0.001,0.002,101325);
    expect(result.cloud).toBeLessThan(1e-8);
    expect(result.vapor).toBeCloseTo(0.003, 7);
    expect(result.temperature).toBeCloseTo(288.17488, 4);
  });
  it('does not invent condensate for unsaturated vapor', () => {
    const result = equilibrate(293.15,0.005,0,101325);
    expect(result.cloud).toBeLessThan(1e-9);
    expect(result.temperature).toBeCloseTo(293.15, 5);
  });
});

describe('sealed window illumination', () => {
  it('distinguishes the three land strips from their neighboring windows', () => {
    for (const angle of [-Math.PI/2,Math.PI/6,5*Math.PI/6]) expect(isWindow(angle,0.45)).toBe(false);
    for (const angle of [-Math.PI/6,Math.PI/2,7*Math.PI/6]) expect(isWindow(angle,0.45)).toBe(true);
  });
  it('clips rays against the sidewall and endcaps, including axial rays', () => {
    expect(boundaryDistance([0,0,0],[0,0,1],4,24)).toBeCloseTo(12);
    expect(boundaryDistance([0,-3,0],[0,1,0],4,24)).toBeCloseTo(7);
    expect(boundaryDistance([0,0,10],[Math.SQRT1_2,0,Math.SQRT1_2],4,24)).toBeCloseTo(2*Math.SQRT2);
  });
  it('blocks direct sunlight through land and sealed caps but admits it through a window', () => {
    const s = { ...defaults, lightMode:'sun' as const, sunElevation:0, sunAzimuth:90 };
    expect(directIllumination([0,-3.5,0],s)).toBeGreaterThan(0.8);
    expect(directIllumination([0,-3.5,0],{ ...s,sunAzimuth:270 })).toBe(0);
    expect(directIllumination([0,-3.5,11.9],{ ...s,sunElevation:35 })).toBe(0);
    expect(directIllumination([0,-3.5,0],{ ...s,windowTransmission:0 })).toBe(0);
  });
});
