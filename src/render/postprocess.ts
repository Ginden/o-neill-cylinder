import * as THREE from 'three';
import denoise from './shaders/denoise.glsl?raw';

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
