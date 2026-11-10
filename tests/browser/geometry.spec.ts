import {openIsolatedPage} from './isolated';
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('intersects exposed land-sector terrace faces with their angular normals',async({page})=>{
  const source=(await Promise.all(['common','landscape','surface','geometry'].map(file=>readFile(`src/render/shaders/${file}.glsl`,'utf8')))).join('\n');
  await page.goto('about:blank');
  const result=await page.evaluate(source=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=1;
    const gl=canvas.getContext('webgl2')!;
    const compile=(type:number,source:string)=>{
      const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
      return shader;
    };
    const program=gl.createProgram()!;
    gl.attachShader(program,compile(gl.VERTEX_SHADER,`#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;precision highp int;precision highp sampler3D;
      ${source}
      out vec4 outColor;
      void main(){
        float edge=-PI*0.5+(1.0-uWindowFraction)*PI/3.0;
        vec3 normal=vec3(-sin(edge),cos(edge),0);
        float angle=edge+0.03,radius=3.84+gl_FragCoord.x/16.0*0.12;
        vec3 p=vec3(radius*cos(angle),radius*sin(angle),0);
        float expected=dot(p,normal),distance=traceInterior(p,-normal);
        vec3 hit=p-normal*distance;
        outColor=vec4(dot(interiorNormal(hit),normal)*0.5+0.5,
          abs(distance-expected)*100.0,abs(surfaceDistance(hit))*100.0,1);
      }`));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    for(const [key,value] of Object.entries({uRadius:4,uLength:24,uTerrainHeight:0.2,uWindowFraction:0.45})) gl.uniform1f(gl.getUniformLocation(program,key),value);
    gl.uniform1i(gl.getUniformLocation(program,'uCachedTerrain'),1);
    const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,1,1,0,gl.RED,gl.FLOAT,new Float32Array([0.2]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(program,'uTerrain'),0);
    gl.viewport(0,0,16,1);gl.drawArrays(gl.TRIANGLES,0,3);
    const pixels=new Uint8Array(16*4);gl.readPixels(0,0,16,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const error=gl.getError();gl.getExtension('WEBGL_lose_context')!.loseContext();
    return {pixels:Array.from(pixels),error};
  },source);
  expect(result.error).toBe(0);
  for(let i=0;i<16;i++) {
    expect(result.pixels[i*4],`normal at terrace ray ${i}`).toBeGreaterThan(253);
    // The tracing tolerance is 5 cm; RGBA8 quantizes each error channel by 4 cm.
    expect(result.pixels[i*4+1],`intersection error at terrace ray ${i}`).toBeLessThan(3);
    expect(result.pixels[i*4+2],`surface residual at terrace ray ${i}`).toBeLessThan(3);
  }
});

test('keeps subpixel window rings in the pane domain and detects mixed edge coverage',async({page})=>{
  const source=(await Promise.all(['common','landscape','surface','geometry','guides'].map(file=>readFile(`src/render/shaders/${file}.glsl`,'utf8')))).join('\n');
  await openIsolatedPage(page);
  const result=await page.evaluate(async source=>{
    const module='/node_modules/three/build/three.module.js',THREE=await import(module);
    const renderer=new THREE.WebGLRenderer(),target=new THREE.WebGLRenderTarget(1,1,{count:3,type:THREE.FloatType,depthBuffer:false});
    const matrix=new THREE.Matrix4();
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:source,
      uniforms:{uRadius:{value:4},uLength:{value:24},uTerrainHeight:{value:0.2},uWindowFraction:{value:0.45},
        uCachedTerrain:{value:false},uCameraPosition:{value:new THREE.Vector3()},uCameraMatrix:{value:matrix},uWeather:{value:null},uCloudPhase:{value:null},
        uInverseProjection:{value:new THREE.Matrix4()},uResolution:{value:new THREE.Vector2(1,1)}}});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();scene.add(new THREE.Mesh(geometry,material));
    const read=(angle:number)=>{
      matrix.set(-Math.sin(angle),0,Math.cos(angle),0,Math.cos(angle),0,Math.sin(angle),0,0,1,0,0,0,0,0,1);
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const data=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,data,0,1);return Array.from(data);
    };
    // z=0 is a real structural ring. The center ray hits steel; corner rays hit glass.
    const ring=read(-Math.PI/6),edge=read(-Math.PI/2+0.55*Math.PI/3+0.03);
    const error=renderer.getContext().getError();geometry.dispose();material.dispose();target.dispose();renderer.dispose();
    return {ring,edge,error};
  },source);
  expect(result.error).toBe(0);
  expect(result.ring[3]).toBe(3);
  expect(result.edge[3]).toBe(-1);
});

test('marches terrain, trees and houses without skipping geometry',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const threeModule='/node_modules/three/build/three.module.js',rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts';
    const THREE=await import(threeModule),{HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule);
    const source=(await Promise.all(['common','landscape','surface','geometry'].map(name=>fetch(`/src/render/shaders/${name}.glsl`).then(response=>response.text())))).join('\n');
    const canvas=document.createElement('canvas');canvas.style.cssText='width:32px;height:32px';document.body.append(canvas);
    // Constructing the renderer bakes the terrain and land-cover atlases.
    const habitat=new HabitatRenderer(canvas,{...defaults,quality:'fast',clouds:false,paused:true});
    habitat.resize(32,32,'fast');habitat.render();
    const size=32;
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',uniforms:habitat.material.uniforms,
      fragmentShader:source+`
        out vec4 outColor;
        float random(inout uint state) {state=state*747796405u+2891336453u;return float((state>>8u)&65535u)/65536.0;}
        // The reference tests objects directly: reusing occupancy skipping here
        // would let the same missing crown disappear from both estimators.
        float referenceDistance(vec3 p) {
          float above,base=baseDistance(p,above);
          if (above < -0.003 || above > CANOPY_TOP+0.01) return base;
          vec2 g=groundCoordinates(p),id;float roof,radius=length(p.xy);
          float tree=treeDistance(g,uRadius-radius,radius/uRadius,id);
          float house=houseDistance(g,uRadius-radius,radius/uRadius,roof,id);
          return min(base,min(tree,house));
        }
        void main(){
          uint state=uint(gl_FragCoord.x)*9781u+uint(gl_FragCoord.y)*6271u;
          // Points 2–25 m above woodland, hedgerows or villages around the valley
          // view, aimed nearly horizontally through the tree and roof layer.
          float theta,z;
          for(int i=0;i<16;i++){
            theta=-PI*0.5+(random(state)-0.5)*0.9;z=-8.4+random(state)*4.0;
            vec4 cover=coverAt(vec2(mod(theta-PI*0.5,2.0*PI)*uRadius,z));
            if(cover.a+cover.b>0.0) break;
          }
          vec3 up=-vec3(cos(theta),sin(theta),0.0);
          vec3 p=-up*uRadius+vec3(0,0,z);
          p+=up*(terrainAt(p)+0.002+random(state)*0.023);
          float elevation=mix(-0.35,0.15,random(state)),azimuth=random(state)*2.0*PI;
          vec3 d=normalize(up*sin(elevation)+(vec3(up.y,-up.x,0.0)*cos(azimuth)+vec3(0,0,1)*sin(azimuth))*cos(elevation));
          if (referenceDistance(p)<0.0) {outColor=vec4(-1.0);return;}
          float traced=traceInterior(p,d),brute=1e3;
          for(int i=0;i<1500;i++){
            float t=float(i)*0.0005;
            if(t>min(traced+0.002,0.75)) break;
            if(referenceDistance(p+d*t)<0.0){brute=t;break;}
          }
          outColor=vec4(traced,brute,0.0,1.0);
        }`});
    const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    habitat.renderer.setRenderTarget(target);habitat.renderer.render(scene,new THREE.Camera());
    const data=new Float32Array(size*size*4);habitat.renderer.readRenderTargetPixels(target,0,0,size,size,data);
    let rays=0,missed=0;
    for(let i=0;i<size*size;i++) {
      if(data[i*4]<0) continue;
      rays++;
      // A brute-force hit more than 1 m before the marched one is skipped geometry.
      if(data[i*4+1]<data[i*4]-0.001) missed++;
    }
    const error=habitat.renderer.getContext().getError();
    material.dispose();plane.dispose();target.dispose();habitat.dispose();canvas.remove();
    return {rays,missed,error};
  });
  expect(result.error).toBe(0);
  expect(result.rays).toBeGreaterThan(600);
  expect(result.missed).toBe(0);
});

test('does not cull crowns when small-cylinder occupancy texels are narrower than the trees',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const threeModule='/node_modules/three/build/three.module.js',rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts';
    const THREE=await import(threeModule),{HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule);
    const source=(await Promise.all(['common','landscape','surface','geometry'].map(name=>fetch(`/src/render/shaders/${name}.glsl`).then(r=>r.text())))).join('\n');
    const habitat=new HabitatRenderer(document.createElement('canvas'),{...defaults,radius:0.5,length:2,terrainHeight:0,quality:'balanced',clouds:false,paused:true});
    habitat.preview.prepare(habitat.renderer);
    const size=32,material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',uniforms:habitat.material.uniforms,
      fragmentShader:source+`
        out vec4 outColor;
        void main(){
          // A crown overhangs an empty fine mip footprint at this forest edge.
          vec2 g=vec2(1.8505311,0.97335815)+(gl_FragCoord.xy/32.0-0.5)*0.006;
          float angle=g.x/uRadius+PI*0.5;
          vec3 p=vec3((uRadius-0.01545586)*vec2(cos(angle),sin(angle)),g.y);
          float radius=length(p.xy),roof,kind;vec2 id;
          g=groundCoordinates(p);
          float tree=treeDistance(g,uRadius-radius,radius/uRadius,id);
          float house=houseDistance(g,uRadius-radius,radius/uRadius,roof,id);
          outColor=vec4(min(tree,house),objectDistance(p,uRadius-radius,kind,id),0,1);
        }`});
    const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    habitat.renderer.setRenderTarget(target);habitat.renderer.render(scene,new THREE.Camera());
    const pixels=new Float32Array(size*size*4);habitat.renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
    let inside=0,missed=0;
    for(let i=0;i<pixels.length;i+=4) if(pixels[i]<-0.0001) {
      inside++;if(pixels[i+1]>0.00005) missed++;
    }
    const error=habitat.renderer.getContext().getError();
    material.dispose();plane.dispose();target.dispose();habitat.dispose();
    return {inside,missed,error};
  });
  expect(result.error).toBe(0);
  expect(result.inside).toBeGreaterThan(10);
  expect(result.missed).toBe(0);
});

test('stands the ground view on the surface the GPU draws',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const threeModule='/node_modules/three/build/three.module.js',rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts',terrainModule='/src/terrain.ts';
    const THREE=await import(threeModule),{HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule);
    const {surfaceHeight,terrainAtlasSize,windowAt}=await import(terrainModule);
    const settings={...defaults,quality:'fast',clouds:false};
    const renderer=new HabitatRenderer(document.createElement('canvas'),settings);
    renderer.resize(32,32,'fast',1);renderer.render(true);
    // Filtered terrain atlas at land points, as the tracer and preview read it.
    const count=128,points=new Float32Array(count*4),cpu:number[]=[];
    // Golden-ratio sequence over the wall, skipping window bands.
    for(let k=0;cpu.length<count;k++) {
      const theta=(k*2.399963)%(2*Math.PI),z=((k*0.618034)%1-0.5)*settings.length;
      if(windowAt(theta,settings)) continue;
      points.set([((theta-Math.PI/2)/(2*Math.PI)%1+1)%1,z/settings.length+0.5,0,1],cpu.length*4);
      cpu.push(surfaceHeight(theta,z,settings,terrainAtlasSize(settings)));
    }
    const input=new THREE.DataTexture(points,count,1,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true;
    const target=new THREE.WebGLRenderTarget(count,1,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{uPoints:{value:input},uTerrain:{value:renderer.preview.terrain.texture}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:'uniform sampler2D uPoints;uniform sampler2D uTerrain;out vec4 o;void main(){o=vec4(textureLod(uTerrain,texelFetch(uPoints,ivec2(gl_FragCoord.xy),0).xy,0.0).r,0,0,1);}'});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    renderer.renderer.setRenderTarget(target);renderer.renderer.render(scene,new THREE.Camera());
    const gpu=new Float32Array(count*4);renderer.renderer.readRenderTargetPixels(target,0,0,count,1,gpu);
    let maximum=0,relief=0;
    for(let i=0;i<count;i++) {maximum=Math.max(maximum,Math.abs(cpu[i]-gpu[i*4]));relief=Math.max(relief,cpu[i]);}
    const error=renderer.renderer.getContext().getError();
    plane.dispose();material.dispose();target.dispose();input.dispose();renderer.dispose();
    return {maximum,relief,error};
  });
  expect(result.error).toBe(0);
  expect(result.relief).toBeGreaterThan(0.05);
  // Kilometres: a few centimetres against a 1.7 m eye height.
  expect(result.maximum).toBeLessThan(5e-5);
});

test('preserves partial endcap texels and filters inside each atlas disc', async ({ page }) => {
  await openIsolatedPage(page);
  const result = await page.evaluate(async () => {
    const rendererModule = '/src/render/renderer.ts', settingsModule = '/src/settings.ts', threeModule = '/node_modules/three/build/three.module.js';
    const { HabitatRenderer } = await import(rendererModule), { defaults } = await import(settingsModule), THREE = await import(threeModule);
    const habitat = new HabitatRenderer(document.createElement('canvas'), { ...defaults, paused: true });
    // Constant incident irradiance isolates the atlas estimator from varying
    // illumination: every nonempty texel must retain exactly the same mean.
    let source = habitat.material.fragmentShader;
    const signature = 'vec4 pathRadiance(vec3 p,vec3 direction,int dropletLimit,bool excludeDirect,bool surfaceCache,out vec4 hazeRadiance) {';
    source = source.replace(signature, `${signature} hazeRadiance=vec4(0.0);return vec4(1.0);}\n${signature.replace('pathRadiance(', 'unusedRadiance(')}`);
    const begin = source.indexOf('  vec3 bands=vec3(spectralXYZ'), end = source.indexOf('\n  if (any(isnan(bands))', begin);
    if (begin < 0 || end < 0) throw new Error('Missing surface irradiance estimator');
    source = source.slice(0, begin) + '  vec3 bands=vec3(1.0);' + source.slice(end);
    habitat.material.fragmentShader = source; habitat.material.needsUpdate = true;
    const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    for (let sample = 0; sample < 32; sample++) {
      for (let band = 0; band < 8; band++) { habitat.advanceSurface(false, false); await tick(); }
    }
    const atlas = habitat.surfaceTargets[habitat.surfaceIndex], pixels = new Float32Array(128 * 192 * 4);
    habitat.renderer.readRenderTargetPixels(atlas, 0, 0, 128, 192, pixels);
    let minimum = Infinity, outsideMaximum = 0, partial = 0;
    for (let cap=0;cap<2;cap++) for (let y=0;y<64;y++) for (let x=0;x<64;x++) {
      const nearestX = Math.max(0, Math.abs((x+0.5)/32-1)-1/64), nearestY = Math.max(0, Math.abs((y+0.5)/32-1)-1/64);
      const value = pixels[((128+y)*128+cap*64+x)*4];
      if (Math.hypot(nearestX, nearestY) < 1) {
        minimum = Math.min(minimum, value);
        if (Math.hypot((x+0.5)/32-1, (y+0.5)/32-1) > 0.97) partial++;
      } else outsideMaximum = Math.max(outsideMaximum, value);
    }
    // Test every rim angle and all nine preview tent offsets. The direct bake
    // uses the same lookup function at a different size, checked as well.
    const lookup = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...habitat.material.uniforms, uTestAtlas: { value: atlas.textures[0] } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: source.slice(0, source.indexOf('void main() {')) + `
        uniform sampler2D uTestAtlas;
        void main(){
          float angle=(gl_FragCoord.x-0.5)/360.0*2.0*PI;
          int row=int(gl_FragCoord.y),cap=row/9,offset=row%9;
          vec3 p=vec3(uRadius*vec2(cos(angle),sin(angle)),cap==0 ? -uLength*0.5 : uLength*0.5);
          outColor=vec4(surfaceAtlasLight(uTestAtlas,surfaceAtlasCoordinates(p,true),true,vec2(offset%3-1,offset/3-1)),1.0);
        }` });
    const scene = new THREE.Scene(), plane = new THREE.PlaneGeometry(2,2); scene.add(new THREE.Mesh(plane, lookup));
    const target = new THREE.WebGLRenderTarget(360,18,{type:THREE.FloatType,depthBuffer:false});
    habitat.renderer.setRenderTarget(target); habitat.renderer.render(scene,new THREE.Camera());
    const filtered = new Float32Array(360*18*4); habitat.renderer.readRenderTargetPixels(target,0,0,360,18,filtered);
    let filteredMinimum=Infinity;
    for(let i=0;i<filtered.length;i+=4) filteredMinimum=Math.min(filteredMinimum,filtered[i]);
    const baked = new Float32Array(512*768*4);
    for(let y=0;y<256;y++) for(let x=0;x<256;x++) if(Math.hypot((x+0.5)/128-1,(y+0.5)/128-1)<1) {
      for(let cap=0;cap<2;cap++) for(let c=0;c<3;c++) baked[((512+y)*512+cap*256+x)*4+c]=cap+1;
    }
    const direct = new THREE.DataTexture(baked,512,768,THREE.RGBAFormat,THREE.FloatType);
    direct.minFilter=direct.magFilter=THREE.LinearFilter;direct.needsUpdate=true;
    lookup.uniforms.uTestAtlas.value=direct;
    habitat.renderer.render(scene,new THREE.Camera());
    habitat.renderer.readRenderTargetPixels(target,0,0,360,18,filtered);
    let directMinimum=Infinity,directMaximum=0;
    for(let i=0;i<filtered.length;i+=4) {
      const relative=filtered[i]/(Math.floor(i/(360*4*9))+1);
      directMinimum=Math.min(directMinimum,relative);directMaximum=Math.max(directMaximum,relative);
    }
    const error=habitat.renderer.getContext().getError();
    direct.dispose();lookup.dispose();plane.dispose();target.dispose();habitat.dispose();
    return {minimum,outsideMaximum,partial,filteredMinimum,directMinimum,directMaximum,error};
  });
  expect(result.error).toBe(0);
  expect(result.partial).toBeGreaterThan(200);
  expect(result.minimum).toBeCloseTo(1,5);
  expect(result.outsideMaximum).toBe(0);
  expect(result.filteredMinimum).toBeCloseTo(1,5);
  expect(result.directMinimum).toBeCloseTo(1,5);
  expect(result.directMaximum).toBeCloseTo(1,5);
});
