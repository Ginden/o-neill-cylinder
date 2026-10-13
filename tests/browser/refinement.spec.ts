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
  await page.route('**/src/main.ts',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const rendererModule='/src/render/renderer.ts',settingsModule='/src/settings.ts',navigationModule='/src/render/navigation.ts';
    const {HabitatRenderer}=await import(rendererModule),{defaults}=await import(settingsModule),{Navigation}=await import(navigationModule);
    const canvas=document.createElement('canvas');canvas.style.width='640px';canvas.style.height='480px';document.body.append(canvas);
    const settings={...defaults,quality:'fast',clouds:false,paused:true};
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
    const error=gl.getError();renderer.dispose();canvas.remove();
    return {filtered,raw,before,after,measured,retainedMeter,error};
  });
  await test.info().attach('denoise-metrics',{body:JSON.stringify(result),contentType:'application/json'});
  await writeFile(test.info().outputPath('denoise-metrics.json'),JSON.stringify(result));
  expect(result.error).toBe(0);
  expect(result.after).toBe(result.before+1);
  expect(result.filtered).toBeLessThan(result.raw*0.6);
  expect(result.measured).toBeGreaterThan(0);
  expect(result.retainedMeter).toBe(result.measured);
});
