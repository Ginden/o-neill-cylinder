import {openIsolatedPage} from './isolated';
import {canvasPixels,captureErrors,waitForScene} from './canvas';
import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('uses raster navigation during interaction and resumes static accumulation',async({page})=>{
  const errors=captureErrors(page);
  await page.goto('/?s='+Buffer.from(JSON.stringify({quality:'fast',clouds:false,paused:true})).toString('base64'));
  await waitForScene(page);
  const canvas=page.locator('#scene');
  await expect.poll(()=>canvas.getAttribute('data-mode')).toBe('path');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-samples'))).toBeGreaterThan(3);
  const box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+20,{steps:8});
  await expect.poll(()=>canvas.getAttribute('data-mode')).toBe('preview');
  const during=Number(await canvas.getAttribute('data-samples'));
  await page.evaluate(()=>new Promise<void>(resolve=>{
    let frames=0;function frame(){if(++frames>=6) resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);
  }));
  expect(Number(await canvas.getAttribute('data-samples'))).toBe(during);
  const preview=await canvasPixels(page);
  expect(preview.max-preview.min).toBeGreaterThan(50);
  await page.mouse.up();
  await expect.poll(()=>canvas.getAttribute('data-mode')).toBe('path');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-samples'))).toBeGreaterThan(during+3);
  expect(errors).toEqual([]);
});

test('denoises the static display without changing camera history or light-meter data',async({page})=>{
  // Run a controlled renderer: no background animation may add samples between comparisons.
  await openIsolatedPage(page);
  const result=await page.evaluate(async()=>{
    const rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts',navigationModule='/src/render/navigation.ts';
    const {HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule),{Navigation}=await import(navigationModule);
    const canvas=document.createElement('canvas');canvas.style.width='640px';canvas.style.height='480px';document.body.append(canvas);
    const settings={...defaults,quality:'fast',clouds:false,paused:true,adaptiveExposure:false};
    const renderer=new HabitatRenderer(canvas,settings);new Navigation(renderer.camera,canvas,settings);renderer.resize(640,480,'fast');
    const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    while(renderer.samples<64) {renderer.render();await frame();}
    // Read the filtered display after the outstanding GPU pass completes.
    const gl=canvas.getContext('webgl2')!;gl.finish();
    const roughness=()=>{
      const data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
      let sum=0,count=0;
      for(let y=Math.floor(canvas.height*0.4);y<canvas.height*0.6;y++) for(let x=Math.floor(canvas.width*0.4);x<canvas.width*0.6-1;x++) {
        const index=(x+y*canvas.width)*4;
        for(let channel=0;channel<3;channel++){const difference=data[index+channel]-data[index+4+channel];sum+=difference*difference;count++;}
      }
      return sum/count;
    };
    const filtered=roughness(),before=renderer.samples;
    let measured=renderer.luminance();
    while(measured===null) {await frame();measured=renderer.luminance();}
    renderer.apply({...settings,denoise:false});
    // One sample ensures the display switch is rendered; the history must continue.
    while(renderer.samples===before) {renderer.render();await frame();}
    gl.finish();const raw=roughness(),after=renderer.samples;
    const retainedMeter=renderer.luminance();
    renderer.apply({...settings,denoise:false,adaptiveExposure:true,exposure:2});
    const afterDisplayChange=renderer.samples;
    const error=gl.getError();renderer.dispose();canvas.remove();
    return {filtered,raw,before,after,afterDisplayChange,measured,retainedMeter,error};
  });
  await test.info().attach('denoise-metrics',{body:JSON.stringify(result),contentType:'application/json'});
  await writeFile(test.info().outputPath('denoise-metrics.json'),JSON.stringify(result));
  expect(result.error).toBe(0);
  expect(result.after).toBe(result.before+1);
  expect(result.afterDisplayChange).toBe(result.after);
  expect(result.filtered).toBeLessThan(result.raw*0.6);
  expect(result.measured).toBeGreaterThan(0);
  expect(result.retainedMeter).toBe(result.measured);
});

type FilterCase='haze'|'texture'|'cold'|'speckle'|'edges';
const filterCases:[FilterCase,string][]=[
  ['haze','does not imprint material colors on uniform atmospheric radiance'],
  ['texture','keeps surface texture under uniform illumination'],
  ['cold','fills a zero-contribution pixel using neighboring path uncertainty'],
  ['speckle','smooths a noisy pixel in color and luminance within its material'],
  ['edges','keeps pane color separate from neighboring land']
];
for(const [kind,title] of filterCases) test(title,async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async(kind)=>{
    const threeModule='/node_modules/three/build/three.module.js',filterModule='/src/render/postprocess.ts',colorModule='/src/render/color.ts';
    const THREE=await import(threeModule),{DisplayDenoiser}=await import(filterModule),{MATERIAL_XYZ}=await import(colorModule);
    const size=16,haze=[0.025,0.03,0.055],illumination=0.08,samples=64;
    const total=new Float32Array(size*size*4),scattered=new Float32Array(total.length),geometry=new Float32Array(total.length),albedo=new Float32Array(total.length),medium=new Float32Array(total.length);
    const expected:number[][]=[];
    for(let i=0;i<size*size;i++) {
      geometry.set([0,0,1,8],i*4);
      medium.set([8,0,0,1],i*4);
      // A uniform foreground crosses contrasting fields and a mixed pixel.
      const anchors=i%size===8 ? [0.29,0.25,0.045] : i%size<8 ? [0.08,0.4,0.03] : [0.5,0.1,0.06];
      const speckle=kind==='speckle' && i===size*8+4,pane=kind==='edges' && i%size<2;
      // A mixed-coverage pixel joins every domain, so the pane case has none.
      albedo.set([...anchors,pane ? 3 : kind!=='edges' && i%size===8 ? -1 : 0],i*4);
      const reflected=new THREE.Vector3(...anchors).applyMatrix3(MATERIAL_XYZ).multiplyScalar(illumination).toArray();
      const lit=kind==='texture' || kind==='speckle' || kind==='edges';
      const surface=lit ? reflected : [0,0,0],light=lit ? [0,0,0] : haze;
      if(pane) surface.splice(0,3,0.002,0.04,0.1);
      const color=surface.map((value:number,c:number)=>value+light[c]);
      // Second moments include sampling variance around each mean. An all-zero
      // pixel after 64 samples implies rare, heavy-tailed path contributions.
      const variance=kind==='cold' ? 0.03 : 0.002;
      total.set([...color,surface[1]**2+variance],i*4);scattered.set([...light,light[1]**2+variance],i*4);
      expected.push(color);
      // Sampling noise in one pixel: luminance and color both off, as a few
      // four-wavelength samples would leave them.
      if(speckle) {total[i*4]*=1.5;total[i*4+1]*=1.3;total[i*4+2]*=0.7;}
    }
    if(kind==='cold') {total.fill(0,(size*8+4)*4,(size*8+4)*4+4);scattered.fill(0,(size*8+4)*4,(size*8+4)*4+4);}
    const textures=[total,scattered,geometry,albedo,medium].map(data=>{
      const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;return texture;
    });
    const renderer=new THREE.WebGLRenderer(),plane=new THREE.PlaneGeometry(2,2),filter=new DisplayDenoiser(plane);filter.resize(size,size);
    const output=filter.filter(renderer,{textures:textures.slice(0,2)},{textures:textures.slice(2)},samples);
    const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({uniforms:{image:{value:output}},depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}'});
    const scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
    const pixels=new Float32Array(total.length);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
    let maximumError=0;
    for(let i=0;i<size*size;i++) for(let channel=0;channel<3;channel++) maximumError=Math.max(maximumError,Math.abs(pixels[i*4+channel]-expected[i][channel])/expected[i][channel]);
    const error=renderer.getContext().getError();filter.dispose();plane.dispose();target.dispose();material.dispose();textures.forEach(texture=>texture.dispose());renderer.dispose();
    return {maximumError,error};
  },kind);
  await test.info().attach('filter-error',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.error).toBe(0);
  expect(result.maximumError,JSON.stringify(result)).toBeLessThan(kind==='cold' || kind==='speckle' ? 0.15 : kind==='edges' ? 0.05 : 1e-5);
});
