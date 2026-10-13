import * as THREE from 'three';
import denoise from './shaders/denoise.glsl?raw';
import meter from './shaders/meter.glsl?raw';
import { SOLAR_ILLUMINANCE } from './solar';
import { VisualAdaptation } from './vision';

/** Filters the display only. Radiometric accumulation and light-meter data stay raw. */
export class DisplayDenoiser {
  private readonly targets=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}));
  private readonly material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:denoise,
    uniforms:{uInput:{value:null},uGuideGeometry:{value:null},uGuideAlbedo:{value:null},
      uSize:{value:new THREE.Vector2(1,1)},uStride:{value:1},uSamples:{value:1}}});
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  constructor(geometry:THREE.BufferGeometry) {this.scene.add(new THREE.Mesh(geometry,this.material));}
  resize(width:number,height:number) {
    for (const target of this.targets) target.setSize(width,height);
    this.material.uniforms.uSize.value.set(width,height);
  }
  filter(renderer:THREE.WebGLRenderer,input:THREE.Texture,guides:THREE.WebGLRenderTarget,samples:number) {
    const u=this.material.uniforms;
    u.uGuideGeometry.value=guides.textures[0];u.uGuideAlbedo.value=guides.textures[1];u.uSamples.value=samples;
    for (let pass=0;pass<4;pass++) {
      u.uInput.value=input;u.uStride.value=2**pass;
      const target=this.targets[pass%2];
      renderer.setRenderTarget(target);renderer.render(this.scene,this.camera);input=target.texture;
    }
    renderer.setRenderTarget(null);return input;
  }
  dispose() {for(const target of this.targets) target.dispose();this.material.dispose();}
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
