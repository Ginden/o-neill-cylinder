import {describe,expect,it} from 'vitest';
import {Vector3} from 'three';
import {VisualAdaptation} from '../src/render/vision';
import {MATERIAL_XYZ,SOLAR_WHITE_BALANCE} from '../src/render/color';

describe('visual adaptation',()=>{
  it('preserves an adapted daylight view when illumination changes by several stops',()=>{
    const daylight=new VisualAdaptation(),shade=new VisualAdaptation();
    const scene=Array.from({length:100},(_,i)=>100+i*20);
    daylight.measure(scene);shade.measure(scene.map(value=>value/16));
    expect(shade.exposure(100000)/daylight.exposure(100000)).toBeCloseTo(16,1);
  });
  it('does not let a solar glint or empty black space expose the whole habitat',()=>{
    const landscape=new VisualAdaptation(),withWindow=new VisualAdaptation();
    landscape.measure(Array(100).fill(1000));
    withWindow.measure([...Array(100).fill(1000),...Array(80).fill(0),1e9]);
    expect(withWindow.exposure(100000)).toBeCloseTo(landscape.exposure(100000),8);
  });
  it('adapts gradually, with a slower response when moving into shade',()=>{
    const bright=new VisualAdaptation(),dark=new VisualAdaptation();
    bright.measure([10]);bright.measure([1000]);dark.measure([1000]);dark.measure([10]);
    bright.update(0);expect(bright.luminance).toBeCloseTo(10);
    bright.update(1);dark.update(1);
    expect(bright.luminance).toBeGreaterThan(10);
    expect(bright.luminance).toBeLessThan(1000);
    expect(dark.luminance).toBeGreaterThan(10);
    expect(Math.log(bright.luminance/10)).toBeGreaterThan(Math.log(1000/dark.luminance));
    // The response must not depend on the frame rate.
    const stepped=new VisualAdaptation();stepped.measure([10]);stepped.measure([1000]);
    for(let i=0;i<60;i++) stepped.update(1/60);
    expect(stepped.luminance).toBeCloseTo(bright.luminance,8);
  });
  it('bounds amplification in darkness and retains adaptation through an empty view',()=>{
    const eye=new VisualAdaptation();eye.measure([0.000001]);
    expect(eye.exposure(100000)).toBeLessThan(1800000);
    const before=eye.exposure(100000);eye.measure([0,0,0]);eye.update(10);
    expect(eye.exposure(100000)).toBe(before);
  });
});

it('maps a spectrally neutral sunlit surface to display white without confusing anchors with RGB',()=>{
  const neutral=new Vector3(1,1,1).applyMatrix3(MATERIAL_XYZ);
  expect(neutral.y).toBeCloseTo(1,8);
  const adapted=neutral.applyMatrix3(SOLAR_WHITE_BALANCE);
  expect(adapted.x).toBeCloseTo(0.95047,5);
  expect(adapted.y).toBeCloseTo(1,5);
  expect(adapted.z).toBeCloseTo(1.08883,5);
});
