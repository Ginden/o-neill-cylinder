import { expect,test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openIsolatedPage } from './isolated';

const shaderSource=async()=>(await Promise.all(['common','landscape','surface','geometry'].map(name=>readFile(`src/render/shaders/${name}.glsl`,'utf8')))).join('\n');

test('the observer clearing removes whole trees and houses while preserving distant objects',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async(source)=>{
    const module='/node_modules/three/build/three.module.js',THREE=await import(module);
    const renderer=new THREE.WebGLRenderer(),size=64;
    const terrain=new THREE.DataTexture(new Float32Array([0.1,0,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);
    const cover=new THREE.DataTexture(new Float32Array([1,1,1,1]),1,1,THREE.RGBAFormat,THREE.FloatType);
    terrain.needsUpdate=true;cover.needsUpdate=true;
    const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      uniforms:{uRadius:{value:4},uLength:{value:24},uWindowFraction:{value:0.45},uCachedTerrain:{value:true},
        uTerrain:{value:terrain},uAnchorTerrain:{value:terrain},uLandCover:{value:cover},uCases:{value:4}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      // Each pixel supplies four clearing positions to the same production
      // geometry functions; make that input mutable for this shader fixture.
      fragmentShader:source.replace('uniform vec3 uObjectClearing;','vec3 uObjectClearing;')+`
        uniform int uCases;
        out vec4 outColor;
        void main(){
          bool tree=gl_FragCoord.y<32.0;
          vec2 g=vec2(PI*uRadius+(gl_FragCoord.x/64.0-0.5)*1.6,(mod(gl_FragCoord.y,32.0)/32.0-0.5)*22.0);
          float spacing=tree ? TREE_CELL : HOUSE_CELL;
          vec2 cell=floor(g/spacing);vec4 a,b;hash8(cell+(tree ? 0.0 : 61.0),a,b);
          vec2 center=tree ? (cell+0.5+(a.xy-0.5)*0.4)*TREE_CELL : (cell+0.5)*HOUSE_CELL+(a.xy-0.5)*0.006;
          float height=0.024*(0.72+0.5*a.w);
          float elevation=0.1+(tree ? height*0.6 : 0.002),scale=1.0-elevation/uRadius;
          vec4 distances=vec4(0.0);
          for(int mode=0;mode<uCases;mode++) {
            uObjectClearing=vec3(center,mode==0 ? 0.0 : 0.05);
            // Exercise both sides of the cylindrical atlas seam as well.
            if(mode==1) uObjectClearing.x+=gl_FragCoord.x<32.0 ? 2.0*PI*uRadius : -2.0*PI*uRadius;
            if(mode==2) uObjectClearing.y+=0.1;
            // The anchor is outside 50 m, but the object's footprint overlaps.
            if(mode==3) uObjectClearing.y-=0.051;
            vec2 id;float roof;
            distances[mode]=tree ? treeDistance(center,elevation,scale,id) : houseDistance(center,elevation,scale,roof,id);
            if(mode==3 && tree) distances[mode]=all(equal(id,cell)) ? -1.0 : 1.0;
          }
          outColor=distances;
        }`});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    const rows=[];
    for(const radius of [4,17.5]) {
      material.uniforms.uRadius.value=radius;
      renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
      const pixels=new Float32Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
      const counts=[0,0],failures:number[][]=[];
      for(let i=0;i<size*size;i++) {
        if(pixels[i*4]>=0) continue; // Only actually occupied procedural lots.
        counts[i<size*size/2 ? 0 : 1]++;
        const values=Array.from(pixels.slice(i*4,i*4+4));
        if(values[1]<=0 || Math.abs(values[0]-values[2])>1e-6 || values[3]<=0) failures.push([i,...values]);
      }
      rows.push({radius,counts,failures});
    }
    const error=renderer.getContext().getError();material.dispose();plane.dispose();target.dispose();terrain.dispose();cover.dispose();renderer.dispose();
    return {rows,error};
  },await shaderSource());
  expect(result.error).toBe(0);
  for(const row of result.rows) {
    expect(row.counts[0],`trees at radius ${row.radius}`).toBeGreaterThan(1000);
    expect(row.counts[1],`houses at radius ${row.radius}`).toBeGreaterThan(10);
    expect(row.failures,`cleared/retained objects at radius ${row.radius}`).toEqual([]);
  }
});

test('ground-view clearing follows the camera and is disabled in free flight',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async(source)=>{
    const threeModule='/node_modules/three/build/three.module.js',rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts';
    const THREE=await import(threeModule),{HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule);
    const settings={...defaults,radius:17.5,view:'ground',clouds:false,paused:true,quality:'fast'};
    const habitat=new HabitatRenderer(document.createElement('canvas'),settings);habitat.resize(16,16,'fast',1);
    const terrain=new THREE.DataTexture(new Float32Array([0.1,0,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);
    const cover=new THREE.DataTexture(new Float32Array([1,1,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);
    terrain.needsUpdate=true;cover.needsUpdate=true;
    const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      uniforms:{...habitat.material.uniforms,uTerrain:{value:terrain},uAnchorTerrain:{value:terrain},uLandCover:{value:cover}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:source+`
        out vec4 outColor;
        void main(){
          vec2 cell=vec2(floor(PI*uRadius/TREE_CELL),-1000);vec4 a,b;hash8(cell,a,b);
          vec2 center=(cell+0.5+(a.xy-0.5)*0.4)*TREE_CELL,id;
          float elevation=0.1+0.024*(0.72+0.5*a.w)*0.6;
          outColor=vec4(center,treeDistance(center,elevation,1.0-elevation/uRadius,id),1);
        }`});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    const read=()=>{
      habitat.renderer.setRenderTarget(target);habitat.renderer.render(scene,new THREE.Camera());
      const pixels=new Float32Array(4);habitat.renderer.readRenderTargetPixels(target,0,0,1,1,pixels);return Array.from(pixels);
    };
    const initial=read(),angle=initial[0]/settings.radius+Math.PI/2,values=[];
    const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    for(const [view,shift] of [['ground',0],['ground',0.1],['ground',0],['valley',0]] as const) {
      habitat.apply({...settings,view});
      habitat.camera.position.set((settings.radius-0.1017)*Math.cos(angle),(settings.radius-0.1017)*Math.sin(angle),initial[1]+shift);
      while(!habitat.render(true)) await frame();
      values.push(read()[2]);
      await frame();
    }
    const error=habitat.renderer.getContext().getError();material.dispose();plane.dispose();target.dispose();terrain.dispose();cover.dispose();habitat.dispose();
    return {initial:initial[2],values,error};
  },await shaderSource());
  expect(result.error).toBe(0);
  expect(result.initial).toBeLessThan(0);
  expect(result.values[0]).toBeGreaterThan(0);
  expect(result.values[1]).toBeCloseTo(result.initial,6);
  expect(result.values[2]).toBeGreaterThan(0);
  expect(result.values[3]).toBeCloseTo(result.initial,6);
});

test('camera rays clear objects while both cache path starters retain them', async ({ page }) => {
  await openIsolatedPage(page);
  const pixels=await page.evaluate(async()=>{
    const rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts',threeModule='/node_modules/three/build/three.module.js';
    const {HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule),THREE=await import(threeModule);
    const habitat=new HabitatRenderer(document.createElement('canvas'),{...defaults,paused:true});
    habitat.material.uniforms.uObjectClearing.value.set(Math.PI*defaults.radius,0,0.05);
    const source=habitat.material.fragmentShader;
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:habitat.material.uniforms,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:source.slice(0,source.indexOf('void main() {'))+`
        void main(){
          int mode=int(gl_FragCoord.x);vec3 origin,direction;float density;int hero;bool air;
          if(mode==1) startCachePath(origin,direction,density,hero,air);
          if(mode==2) startSurfacePath(origin,direction);
          bool cleared=clearedObject(vec2(PI*uRadius,0),0.004,0.12);
          outColor=vec4(cameraClearing ? 1.0 : 0.0,cleared ? 1.0 : 0.0,0,1);
        }`});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    const target=new THREE.WebGLRenderTarget(3,1,{type:THREE.FloatType,depthBuffer:false});
    habitat.renderer.setRenderTarget(target);habitat.renderer.render(scene,new THREE.Camera());
    const pixels=new Float32Array(12);habitat.renderer.readRenderTargetPixels(target,0,0,3,1,pixels);
    material.dispose();plane.dispose();target.dispose();habitat.dispose();return Array.from(pixels);
  });
  expect(pixels).toEqual([1,1,0,1,0,0,0,1,0,0,0,1]);
});

test('walking in cloudy Ground view preserves and advances both lighting caches', async ({ page }) => {
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts',weatherModule='/src/weather/solver.ts',transportModule='/src/weather/transport.ts';
    const {HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule),{WeatherSolver}=await import(weatherModule),{prepareWeather}=await import(transportModule);
    const settings={...defaults,clouds:true,humidity:78,paused:true,view:'ground',quality:'fast'};
    const habitat=new HabitatRenderer(document.createElement('canvas'),settings);habitat.resize(16,16,'fast',1);
    habitat.setWeather(prepareWeather({...new WeatherSolver(settings).snapshot(),revision:1},settings,habitat.transportOptics));
    // Cheap constant radiance leaves the real scheduling, cache updates and
    // observer changes intact, without tracing millions of CI cloud paths.
    const signature='vec4 pathRadiance(vec3 p,vec3 direction,int dropletLimit,bool excludeDirect,bool surfaceCache,out vec4 hazeRadiance) {';
    habitat.material.fragmentShader=habitat.material.fragmentShader.replace(signature,`${signature}hazeRadiance=vec4(0.0);return vec4(0.01);}\n${signature.replace('pathRadiance(','unusedRadiance(')}`);
    habitat.material.needsUpdate=true;
    const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    const iterations:number[]=[],surfaceSamples:number[]=[];
    for(let step=0;step<24;step++) {
      habitat.camera.position.set(0,-3.8,step*0.001);
      while(!habitat.render(true)) await frame();
      iterations.push(habitat.cacheIteration);surfaceSamples.push(habitat.surfaceSample);await frame();
    }
    const error=habitat.renderer.getContext().getError();habitat.dispose();return {iterations,surfaceSamples,error};
  });
  expect(result.error).toBe(0);
  expect(result.iterations.at(-1)).toBeGreaterThanOrEqual(3);
  expect(result.surfaceSamples.at(-1)).toBeGreaterThanOrEqual(3);
  for(let i=1;i<result.iterations.length;i++) expect(result.iterations[i]).toBeGreaterThanOrEqual(result.iterations[i-1]);
  for(let i=1;i<result.surfaceSamples.length;i++) expect(result.surfaceSamples[i]).toBeGreaterThanOrEqual(result.surfaceSamples[i-1]);
});
