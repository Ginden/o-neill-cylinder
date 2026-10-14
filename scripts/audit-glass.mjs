/* global document, console, setTimeout, performance */
// Run against npm run dev, on one hardware GPU. Writes exact-path edge-view
// comparisons with fixed exposure, raw luminance blocks and sample variances.
// AUDIT_SAMPLES=256 AUDIT_WIDTH=1280 AUDIT_HEIGHT=720 node scripts/audit-glass.mjs
import { chromium } from '@playwright/test';
import { mkdir,readFile,writeFile } from 'node:fs/promises';

const output=process.env.AUDIT_OUTPUT??'.local/glass-audit';
await mkdir(output,{recursive:true});
const config={samples:Number(process.env.AUDIT_SAMPLES??256),width:Number(process.env.AUDIT_WIDTH??1280),
  height:Number(process.env.AUDIT_HEIGHT??720),
  settings:process.env.AUDIT_SETTINGS ? JSON.parse(await readFile(process.env.AUDIT_SETTINGS,'utf8')) : {}};
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args:['--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu','--headless=new']});
try {
  const page=await browser.newPage({viewport:{width:config.width,height:config.height},deviceScaleFactor:1});
  page.on('pageerror',error=>console.error(error));
  page.on('console',message=>{if(message.type()==='error') console.error(message.text());});
  await page.route(/\/(?:src\/main\.ts(?:\?.*)?|@vite\/client)$/,route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(process.env.AUDIT_URL??'http://127.0.0.1:5173');
  await page.evaluate(async(config)=>{
    const {HabitatRenderer}=await import('/src/render/renderer.ts'),{defaults}=await import('/src/settings.ts');
    const {surfaceHeight,terrainAtlasSize}=await import('/src/terrain.ts');
    const canvas=document.createElement('canvas');document.body.replaceChildren(canvas);
    const settings={...defaults,...config.settings,clouds:false,paused:true,denoise:false,adaptiveExposure:false,exposure:4};
    const habitat=new HabitatRenderer(canvas,settings);
    habitat.resize(config.width,config.height,'high',1);
    const angle=-59*Math.PI/180,radius=settings.radius-surfaceHeight(angle,-6.2,settings,terrainAtlasSize(settings))-0.03;
    const radial=[Math.cos(angle),Math.sin(angle),0],tangent=[-radial[1],radial[0],0];
    habitat.camera.position.set(radius*radial[0],radius*radial[1],-6.2);
    habitat.camera.up.set(-radial[0],-radial[1],0);
    habitat.camera.lookAt(habitat.camera.position.clone().add({x:tangent[0]*0.9-radial[0]*0.25,y:tangent[1]*0.9-radial[1]*0.25,z:0.45}));
    habitat.camera.updateMatrixWorld();
    const uniforms=habitat.material.uniforms;
    uniforms.uSurfaceCache.value=false;
    uniforms.uAuditMode={value:0};
    // Diagnostic variants only; production has no reflection-strength knob.
    habitat.material.fragmentShader='uniform int uAuditMode;\n'+habitat.material.fragmentShader
      .replace('void glassPlate(', 'void correctedGlassPlate(')
      .replace('// Bound on the baked terrain slope', `
        void glassPlate(float cosine,out vec4 r,out vec4 t) {
          correctedGlassPlate(cosine,r,t);
          if (uAuditMode==1) {
            float c=clamp(abs(cosine),0.0,1.0);
            vec4 ct=sqrt(1.0-(1.0-c*c)/(glassIndex*glassIndex));
            vec4 rs=(c-glassIndex*ct)/(c+glassIndex*ct),rp=(glassIndex*c-ct)/(glassIndex*c+ct);
            vec4 f=0.5*(rs*rs+rp*rp),a=pow(vec4(uWindowTransmission),1.0/ct);
            t=(1.0-f)*(1.0-f)*a/max(vec4(1e-8),1.0-f*f*a*a);
            r=f+f*a*t;
          }
        }
        // Bound on the baked terrain slope`)
      .replace('const float REFLECTION_CHANCE=0.85;',`if (uAuditMode==2 && s.order==0) reflectance=vec4(0.0);
        const float REFLECTION_CHANCE=0.85;`);
    habitat.material.needsUpdate=true;
    globalThis.glassAudit={habitat,canvas,settings,config};
  },config);
  const variants=[];
  for (const [name,mode,cached] of [['corrected',0,false],['legacy',1,false],['no-camera-reflection',2,false],['cached',0,true]]) {
    console.log(`Rendering ${name} (${config.samples} samples at ${config.width}×${config.height}${cached ? ', after 256 atlas samples' : ''})`);
    const result=await page.evaluate(async({mode,cached})=>{
      const {habitat,canvas,settings,config}=globalThis.glassAudit;
      habitat.material.uniforms.uAuditMode.value=mode;habitat.material.uniforms.uSurfaceCache.value=cached;
      habitat.resetAccumulation();habitat.resetSurface();
      // Warm the cache before comparing its stationary estimate with exact paths.
      const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
      if(cached) {
        while(habitat.surfaceSample<256) {habitat.render();await tick();}
        habitat.advanceSurface=()=>{};
        habitat.resetAccumulation();
      }
      const gl=habitat.renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
      const gpu=gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),start=performance.now();
      const cols=16,rows=9,count=cols*rows,means=new Float64Array(count),m2=new Float64Array(count);
      let previous=new Float32Array(config.width*config.height*4),last=0;
      while(habitat.samples<config.samples) {
        habitat.render();await tick();
        if(habitat.samples===last) continue;
        const n=habitat.samples,target=habitat.targets[habitat.targetIndex];
        const pixels=new Float32Array(target.width*target.height*4);
        await habitat.renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels);
        const sums=new Float64Array(count),counts=new Uint32Array(count);
        for(let y=0;y<target.height;y++) for(let x=0;x<target.width;x++) {
          const i=(y*target.width+x)*4+1,b=Math.floor(y*rows/target.height)*cols+Math.floor(x*cols/target.width);
          sums[b]+=n*pixels[i]-(n-1)*previous[i];counts[b]++;
        }
        for(let b=0;b<count;b++) {const v=sums[b]/counts[b],delta=v-means[b];means[b]+=delta/n;m2[b]+=delta*(v-means[b]);}
        previous=pixels;last=n;
      }
      const error=gl.getError(),image=canvas.toDataURL('image/png');
      return {gpu,settings,camera:{position:habitat.camera.position.toArray(),quaternion:habitat.camera.quaternion.toArray(),fov:habitat.camera.fov},
        cloudMass:habitat.cloudMass,surfaceSamples:habitat.surfaceSample,raySize:habitat.raySize,samples:habitat.samples,
        seconds:(performance.now()-start)/1000,error,image,cols,rows,
        blocks:Array.from(means,(mean,i)=>({mean,variance:m2[i]/(last-1),standardError:Math.sqrt(m2[i]/(last-1)/last)}))};
    },{mode,cached});
    const {image,...summary}=result;
    if(summary.error || !summary.blocks.every(b=>Number.isFinite(b.mean)) || summary.blocks.every(b=>b.mean===0)) {
      throw new Error(`Invalid ${name} render: GL ${summary.error}, no finite illuminated image`);
    }
    await writeFile(`${output}/${name}.png`,Buffer.from(image.split(',')[1],'base64'));
    await writeFile(`${output}/${name}.json`,JSON.stringify(summary,null,2));
    variants.push({name,...summary});
    console.log(JSON.stringify({name,seconds:summary.seconds,error:summary.error,mean:summary.blocks.reduce((a,b)=>a+b.mean,0)/summary.blocks.length}));
  }
  await writeFile(`${output}/report.json`,JSON.stringify(variants,null,2));
} finally {await browser.close();}
