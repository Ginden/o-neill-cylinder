import {openIsolatedPage} from './isolated';
import { expect,test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('GPU ratio tracking and collision survival agree with analytic Beer–Lambert slabs',async({page})=>{
  const files=['common','landscape','surface','geometry','spectrum','transport'];
  const source=(await Promise.all(files.map(file=>readFile(`src/render/shaders/${file}.glsl`,'utf8')))).join('\n');
  await page.goto('about:blank');
  const result=await page.evaluate(fragment=>{
    const canvas=document.createElement('canvas');canvas.width=6144;canvas.height=1;
    const gl=canvas.getContext('webgl2')!;
    function compile(type:number,source:string) {
      const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
      return shader;
    }
    const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`);
    const shader=compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;precision highp int;precision highp sampler3D;
      ${fragment}
      out vec4 outColor;
      void main(){
        rngState=uint(gl_FragCoord.x)*9781u+0x68bc21ebu;
        wavelength=550.0;spectralBin=17.0;prepareWavelength();
        int band=int(gl_FragCoord.x)/2048;
        float distance=band==0 ? 0.0 : band==1 ? 10.0 : 40.0;
        float transmission=shadowTransmission(vec3(0),vec3(0,0,1),distance);
        float weight=1.0;vec3 point;int species;
        bool collision=mediumEvent(vec3(0),vec3(0,0,1),distance,weight,point,species);
        outColor=vec4(transmission,collision ? 0.0 : weight,0.0,1.0);
      }`);
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,shader);gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    for (const [key,value] of Object.entries({uRadius:40,uLength:200,uTemperature:288.15,uPressure:1013.25,uLapse:0,uGravity:0,uAirMajorant:0.063,uAerosol:0,uAerosolScale:0})) {
      gl.uniform1f(gl.getUniformLocation(program,key),value);
    }
    gl.uniform1i(gl.getUniformLocation(program,'uAtmosphere'),1);
    gl.uniform1i(gl.getUniformLocation(program,'uClouds'),0);
    const weather=gl.createTexture()!;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,weather);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA32F,1,1,1,0,gl.RGBA,gl.FLOAT,new Float32Array(4));
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(program,'uWeather'),0);
    const bounds=gl.createTexture()!;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,bounds);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.R32F,2,2,2,0,gl.RED,gl.FLOAT,new Float32Array(8));
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(program,'uCloudMajorant'),1);
    const phase=gl.createTexture()!;gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,phase);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1024,41,0,gl.RGBA,gl.FLOAT,new Float32Array(1024*41*4));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(program,'uAerosolPhase'),2);gl.uniform1i(gl.getUniformLocation(program,'uCloudPhase'),2);
    gl.viewport(0,0,canvas.width,1);gl.drawArrays(gl.TRIANGLES,0,3);
    const pixels=new Uint8Array(canvas.width*4);gl.readPixels(0,0,canvas.width,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const means=Array.from({length:3},(_,band)=>{
      let ratio=0,survival=0;
      for (let i=band*2048;i<(band+1)*2048;i++) {ratio+=pixels[i*4]/255;survival+=pixels[i*4+1]/255;}
      return {ratio:ratio/2048,survival:survival/2048};
    });
    const error=gl.getError();gl.getExtension('WEBGL_lose_context')!.loseContext();
    return {means,error};
  },source);
  expect(result.error).toBe(0);
  for (const [i,distance] of [0,10,40].entries()) {
    const expected=Math.exp(-0.013558*distance);
    expect(Math.abs(result.means[i].ratio-expected)).toBeLessThan(0.01);
    expect(Math.abs(result.means[i].survival-expected)).toBeLessThan(0.025);
  }
});

test('rough water conserves reflected energy and obeys reciprocity',async({page})=>{
  const files=['common','landscape','surface','geometry','spectrum','transport'];
  const source=(await Promise.all(files.map(file=>readFile(`src/render/shaders/${file}.glsl`,'utf8')))).join('\n');
  await openIsolatedPage(page);
  const result=await page.evaluate(async(source)=>{
    const threeModule='/node_modules/three/build/three.module.js',THREE=await import(threeModule);
    const renderer=new THREE.WebGLRenderer(),target=new THREE.WebGLRenderTarget(3,1,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:source+`
        out vec4 outColor;
        void main(){
          rngState=uint(gl_FragCoord.x)*9781u+0x68bc21ebu;
          float angle=floor(gl_FragCoord.x)*40.0*PI/180.0;
          vec3 normal=vec3(0,0,1),outgoing=vec3(sin(angle),0,cos(angle));
          float energy=0.0,reciprocity=0.0;
          for(int i=0;i<4096;i++) {
            vec3 incoming=waterSample(normal,outgoing);
            vec2 bsdf=waterReflection(normal,outgoing,incoming);
            if(bsdf.y>0.0) {
              energy+=bsdf.x/bsdf.y/4096.0;
              float a=bsdf.x/dot(normal,incoming);
              float b=waterReflection(normal,incoming,outgoing).x/dot(normal,outgoing);
              reciprocity=max(reciprocity,abs(a-b)/max(1e-8,a+b));
            }
          }
          outColor=vec4(energy,reciprocity,0,1);
        }`});
    const plane=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(plane,material));
    renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
    const pixels=new Float32Array(12);renderer.readRenderTargetPixels(target,0,0,3,1,pixels);
    const error=renderer.getContext().getError();material.dispose();plane.dispose();target.dispose();renderer.dispose();
    return {pixels:[...pixels],error};
  },source);
  await test.info().attach('water-reflectance',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.error).toBe(0);
  // Nearly smooth water at normal incidence approaches the analytic Fresnel value.
  expect(result.pixels[0]).toBeCloseTo(((1.333-1)/(1.333+1))**2,2);
  expect(result.pixels[0]).toBeGreaterThan(0.018);
  expect(result.pixels[8]).toBeGreaterThan(result.pixels[0]*5);
  for(const i of [0,4,8]) {
    expect(result.pixels[i]).toBeLessThanOrEqual(1);
    // Single-precision half-vector cancellation is most sensitive at grazing angles.
    expect(result.pixels[i+1]).toBeLessThan(5e-4);
  }
});
