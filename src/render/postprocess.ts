import * as THREE from 'three';
import denoise from './shaders/denoise.glsl?raw';
import meter from './shaders/meter.glsl?raw';
import { SOLAR_ILLUMINANCE } from './solar';
import { VisualAdaptation } from './vision';
import { MATERIAL_XYZ } from './color';

/** Filters the display only. Radiometric accumulation and light-meter data stay raw.
 * Surface light is demodulated by reflectance; haze is filtered separately. */
export class DisplayDenoiser {
  private readonly targets=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.FloatType,depthBuffer:false}));
  private readonly output=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
  private readonly material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:denoise,
    uniforms:{uSurface:{value:null},uHaze:{value:null},uGuideGeometry:{value:null},uGuideAlbedo:{value:null},
      uMaterialXYZ:{value:MATERIAL_XYZ},uSize:{value:new THREE.Vector2(1,1)},uStride:{value:1},uSamples:{value:1},uMode:{value:0}}});
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  constructor(geometry:THREE.BufferGeometry) {this.scene.add(new THREE.Mesh(geometry,this.material));}
  resize(width:number,height:number) {
    for (const target of [...this.targets,this.output]) target.setSize(width,height);
    this.material.uniforms.uSize.value.set(width,height);
  }
  /** `accumulation` holds total radiance and first-collision haze; `guides` holds
   * normal/depth and reflectance/domain. Returns filtered XYZ radiance. */
  filter(renderer:THREE.WebGLRenderer,accumulation:{textures:THREE.Texture[]},guides:{textures:THREE.Texture[]},samples:number) {
    const u=this.material.uniforms;
    u.uGuideGeometry.value=guides.textures[0];u.uGuideAlbedo.value=guides.textures[1];u.uSamples.value=samples;
    const draw=(mode:number,input:{textures:THREE.Texture[]},target:THREE.WebGLRenderTarget,stride=1)=>{
      u.uMode.value=mode;u.uStride.value=stride;u.uSurface.value=input.textures[0];u.uHaze.value=input.textures[1];
      renderer.setRenderTarget(target);renderer.render(this.scene,this.camera);
    };
    draw(0,accumulation,this.targets[0]);
    for (let pass=0;pass<5;pass++) draw(1,this.targets[pass%2],this.targets[(pass+1)%2],2**pass);
    draw(2,this.targets[1],this.output);
    renderer.setRenderTarget(null);return this.output.texture;
  }
  dispose() {for(const target of [...this.targets,this.output]) target.dispose();this.material.dispose();}
}

/** Small asynchronous readback for adaptation; never modifies the path history. */
export class ExposureMeter {
  private readonly target=new THREE.WebGLRenderTarget(32,32,{type:THREE.FloatType,depthBuffer:false});
  private readonly material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:meter,
    uniforms:{uImage:{value:null},uReferenceIlluminance:{value:SOLAR_ILLUMINANCE}}});
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private busy=false;
  private revision=0;
  private disposed=false;
  readonly adaptation=new VisualAdaptation();
  constructor(geometry:THREE.BufferGeometry) {this.scene.add(new THREE.Mesh(geometry,this.material));}
  invalidate() {this.revision++;}
  measure(renderer:THREE.WebGLRenderer,image:THREE.Texture) {
    if(this.busy) return;
    this.busy=true;
    const revision=this.revision;
    this.material.uniforms.uImage.value=image;
    renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);renderer.setRenderTarget(null);
    const pixels=new Float32Array(32*32*4);
    void renderer.readRenderTargetPixelsAsync(this.target,0,0,32,32,pixels).then(()=>{
      if(this.disposed || revision!==this.revision) return;
      const luminance=[];
      for(let i=0;i<pixels.length;i+=4) luminance.push(pixels[i]);
      this.adaptation.measure(luminance);
    }).finally(()=>{this.busy=false;});
  }
  dispose() {this.disposed=true;this.target.dispose();this.material.dispose();}
}
