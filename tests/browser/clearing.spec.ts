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
