import { expect,test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openIsolatedPage } from './isolated';
import { plateReference } from '../glass-reference';

const files=['common','landscape','surface','geometry','spectrum','cache','transport'];
const source=async()=>(await Promise.all(files.map(file=>readFile(`src/render/shaders/${file}.glsl`,'utf8')))).join('\n');

test('GPU glass conserves energy and matches separate s/p internal reflections',async({page})=>{
  const angles=[0,30,60,75,80,85,89,89.9,90],bulks=[0,0.2,0.9,1];
  const indices=[1.53,1.52,1.51,1.50];
  await openIsolatedPage(page);
  const result=await page.evaluate(async({source,angles,bulks,indices})=>{
    const module='/node_modules/three/build/three.module.js',THREE=await import(module);
    const renderer=new THREE.WebGLRenderer(),width=angles.length*2,height=indices.length;
    const target=new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      uniforms:{uWindowTransmission:{value:0},uCosines:{value:angles.map((a:number)=>Math.cos(a*Math.PI/180))},
        uIndices:{value:new THREE.Vector4(...indices)}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:source+`
        uniform float uCosines[${angles.length}];uniform vec4 uIndices;
        out vec4 outColor;
        void main(){
          glassIndex=uIndices;
          float cosine=uCosines[int(gl_FragCoord.x)/2]*(int(gl_FragCoord.x)%2==0 ? -1.0 : 1.0);
          vec4 r,t;glassPlate(cosine,r,t);
          outColor=vec4(r[int(gl_FragCoord.y)%4],t[int(gl_FragCoord.y)%4],0,1);
        }`});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    const rows=[];
    for (const bulk of bulks) {
      material.uniforms.uWindowTransmission.value=bulk;
      renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
      const pixels=new Float32Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
      rows.push(Array.from(pixels));
    }
    const error=renderer.getContext().getError();material.dispose();plane.dispose();target.dispose();renderer.dispose();
    return {rows,error};
  },{source:await source(),angles,bulks,indices});
  expect(result.error).toBe(0);
  for (const [b,bulk] of bulks.entries()) for (const [i,index] of indices.entries()) for (const [a,angle] of angles.entries()) {
    const reference=plateReference(angle,bulk,index);
    for (let side=0;side<2;side++) {
      const offset=(i*angles.length*2+a*2+side)*4,r=result.rows[b][offset],t=result.rows[b][offset+1];
      expect(Math.abs(r-reference.reflectance),`R: ${angle}°, bulk ${bulk}, n ${index}`).toBeLessThan(2e-5);
      expect(Math.abs(t-reference.transmission),`T: ${angle}°, bulk ${bulk}, n ${index}`).toBeLessThan(2e-5);
      expect(r+t).toBeLessThanOrEqual(1+2e-6);
    }
  }
});

test('actual pane path sampling preserves reflected and transmitted energy from either side',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async(source)=>{
    const threeModule='/node_modules/three/build/three.module.js',rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts';
    const THREE=await import(threeModule),{HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule);
    const habitat=new HabitatRenderer(document.createElement('canvas'),{...defaults,atmosphere:false,clouds:false,windowTransmission:0.9});
    habitat.material.uniforms.uSurfaceCache.value=false;
    const size=128,target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      uniforms:{...habitat.material.uniforms,uCosine:{value:1},uFromInside:{value:true}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:source+`
        uniform float uCosine;uniform bool uFromInside;
        out vec4 outColor;
        void main(){
          rngState=(uint(gl_FragCoord.x)+${size}u*uint(gl_FragCoord.y))*9781u+0x68bc21ebu;
          wavelength=vec4(550);spectralBin=vec4(17);prepareWavelength();glassIndex=vec4(1.52);
          vec3 hit=vec3(0,uRadius,0.5),normal=vec3(0,1,0);
          vec3 d=vec3(sqrt(1.0-uCosine*uCosine),uFromInside ? uCosine : -uCosine,0);
          float distance=min(0.02,uRadius*uCosine);
          PathState s=startPath(hit-d*distance,d);s.inside=uFromInside;
          advancePath(s,1,65,0,false);
          bool reflected=s.inside==uFromInside;
          vec3 expected=reflected ? reflect(d,normal) : d;
          float clearance=s.inside ? uRadius-length(s.p.xy) : length(s.p.xy)-uRadius;
          outColor=vec4(reflected ? s.beta.x : 0.0,reflected ? 0.0 : s.beta.x,
            length(s.direction-expected),clearance);
        }`});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    const rows=[];
    for (const inside of [true,false]) for (const angle of [0,60,80,89]) {
      material.uniforms.uCosine.value=Math.cos(angle*Math.PI/180);material.uniforms.uFromInside.value=inside;
      habitat.renderer.setRenderTarget(target);habitat.renderer.render(scene,new THREE.Camera());
      const pixels=new Float32Array(size*size*4);habitat.renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
      const mean=[0,0],square=[0,0];let directionError=0,clearance=Infinity;
      for (let i=0;i<pixels.length;i+=4) {
        for (let c=0;c<2;c++) {mean[c]+=pixels[i+c]/(size*size);square[c]+=pixels[i+c]**2/(size*size);}
        directionError=Math.max(directionError,pixels[i+2]);clearance=Math.min(clearance,pixels[i+3]);
      }
      rows.push({inside,angle,mean,standardError:mean.map((v,c)=>Math.sqrt(Math.max(0,square[c]-v*v)/(size*size))),directionError,clearance});
    }
    const error=habitat.renderer.getContext().getError();material.dispose();plane.dispose();target.dispose();habitat.dispose();
    return {rows,error};
  },await source());
  await test.info().attach('pane-energy',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.error).toBe(0);
  for (const row of result.rows) {
    const reference=plateReference(row.angle,0.9,1.52);
    for (const [channel,expected] of [reference.reflectance,reference.transmission].entries()) {
      expect(Math.abs(row.mean[channel]-expected),JSON.stringify(row)).toBeLessThan(5*row.standardError[channel]+2e-4);
    }
    expect(row.directionError).toBeLessThan(1e-4);
    expect(row.clearance).toBeGreaterThan(0.0001);
  }
});
