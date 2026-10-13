import {openIsolatedPage} from './isolated';
import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('uses raster navigation during interaction and resumes static accumulation',async({page})=>{
  await page.goto('/?s='+Buffer.from(JSON.stringify({quality:'fast',clouds:false,paused:true})).toString('base64'));
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
  const range=await canvas.evaluate((node:HTMLCanvasElement)=>{
    const gl=node.getContext('webgl2')!,pixels=new Uint8Array(node.width*node.height*4);
    gl.readPixels(0,0,node.width,node.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let lowest=255,highest=0;
    for(let i=0;i<pixels.length;i+=4) {lowest=Math.min(lowest,pixels[i]);highest=Math.max(highest,pixels[i]);}
    return highest-lowest;
  });
  expect(range).toBeGreaterThan(50);
  await page.mouse.up();
  await expect.poll(()=>canvas.getAttribute('data-mode')).toBe('path');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-samples'))).toBeGreaterThan(during+3);
  expect(await canvas.evaluate((node:HTMLCanvasElement)=>node.getContext('webgl2')!.getError())).toBe(0);
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

for(const coldPixel of [false,true]) test(coldPixel ? 'fills a zero-contribution pixel using neighboring path uncertainty' : 'does not imprint material colors on uniform atmospheric radiance',async({page})=>{
  await openIsolatedPage(page);
  const result=await page.evaluate(async(coldPixel)=>{
    const threeModule='/node_modules/three/build/three.module.js',filterModule='/src/render/postprocess.ts';
    const THREE=await import(threeModule),{DisplayDenoiser}=await import(filterModule);
    const size=16,expected=[0.025,0.03,0.055],image=new Float32Array(size*size*4),geometry=new Float32Array(image.length),albedo=new Float32Array(image.length);
    for(let i=0;i<size*size;i++) {
      image.set([...expected,0.005],i*4);geometry.set([0,0,1,8],i*4);
      // A uniform foreground medium crosses contrasting fields and a mixed pixel.
      const color=i%size<8 ? [0.08,0.4,0.03] : [0.5,0.1,0.06];
      albedo.set([...color,i%size===8 ? -1 : 0],i*4);
    }
    if(coldPixel) image.fill(0,(size*8+8)*4,(size*8+8)*4+4);
    const textures=[image,geometry,albedo].map(data=>{
      const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;return texture;
    });
    const renderer=new THREE.WebGLRenderer(),plane=new THREE.PlaneGeometry(2,2),filter=new DisplayDenoiser(plane);filter.resize(size,size);
    const output=filter.filter(renderer,textures[0],{textures:textures.slice(1)},64);
    const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({uniforms:{image:{value:output}},depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}'});
    const scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
    const pixels=new Float32Array(image.length);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
    let maximumError=0;
    for(let i=0;i<size*size;i++) for(let channel=0;channel<3;channel++) maximumError=Math.max(maximumError,Math.abs(pixels[i*4+channel]-expected[channel]));
    const error=renderer.getContext().getError();filter.dispose();plane.dispose();target.dispose();material.dispose();textures.forEach(texture=>texture.dispose());renderer.dispose();
    return {maximumError,error};
  },coldPixel);
  expect(result.error).toBe(0);
  expect(result.maximumError).toBeLessThan(coldPixel ? 0.004 : 1e-6);
});
