import {openIsolatedPage} from './isolated';
import {expect,test} from '@playwright/test';

test('tone maps neutral daylight, preserves black, and reduces color only in dim adaptive views',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const threeModule='/node_modules/three/build/three.module.js',colorModule='/src/render/color.ts';
    const THREE=await import(threeModule),{MATERIAL_XYZ,SOLAR_WHITE_BALANCE}=await import(colorModule);
    const source=await (await fetch('/src/render/shaders/tonemap.glsl')).text();
    const renderer=new THREE.WebGLRenderer(),target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:'uniform float uReferenceIlluminance;\n'+source+'\nuniform vec3 uXYZ;out vec4 outColor;void main(){outColor=vec4(displayColor(uXYZ),1);}',
      uniforms:{uXYZ:{value:new THREE.Vector3()},uReferenceIlluminance:{value:100000},uExposure:{value:1},uAdaptive:{value:true},uWhiteBalance:{value:SOLAR_WHITE_BALANCE}}});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    function render(anchors:number[],intensity:number,exposure:number,adaptive=true) {
      material.uniforms.uXYZ.value.set(...anchors).applyMatrix3(MATERIAL_XYZ).multiplyScalar(intensity);
      material.uniforms.uExposure.value=exposure;material.uniforms.uAdaptive.value=adaptive;
      renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
      const pixels=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,pixels);return [...pixels.slice(0,3)];
    }
    const black=render([0,0,0],1,1e6);
    const ramp=[0.001,0.01,0.1,1,10].map(value=>render([1,1,1],value,1));
    const daylight=render([0.05,0.4,0.02],1,1);
    const dim=render([0.05,0.4,0.02],1e-8,1e8);
    const fixed=render([0.05,0.4,0.02],1e-8,1e8,false);
    const error=renderer.getContext().getError();plane.dispose();material.dispose();target.dispose();renderer.dispose();
    return {black,ramp,daylight,dim,fixed,error};
  });
  expect(result.error).toBe(0);
  expect(result.black).toEqual([0,0,0]);
  for(const [i,pixel] of result.ramp.entries()) {
    expect(Math.max(...pixel)-Math.min(...pixel)).toBeLessThan(0.001);
    if(i>0) expect(pixel[1]).toBeGreaterThan(result.ramp[i-1][1]);
  }
  const chroma=(pixel:number[])=>Math.max(...pixel)-Math.min(...pixel);
  expect(chroma(result.daylight)).toBeGreaterThan(0.1);
  expect(chroma(result.dim)).toBeLessThan(0.001);
  expect(chroma(result.fixed)).toBeGreaterThan(0.1);
});
