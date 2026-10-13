import * as THREE from 'three';
import common from './shaders/common.glsl?raw';
import surface from './shaders/surface.glsl?raw';
import geometry from './shaders/geometry.glsl?raw';
import terrain from './shaders/terrain.glsl?raw';
import light from './shaders/preview-light.glsl?raw';
import vertex from './shaders/preview-vertex.glsl?raw';
import fragment from './shaders/preview-fragment.glsl?raw';
import tonemap from './shaders/tonemap.glsl?raw';
import { MATERIAL_XYZ,SOLAR_WHITE_BALANCE,LAMP_XYZ } from './color';
import { SOLAR_ILLUMINANCE } from './solar';

const fullscreenVertex='void main(){gl_Position=vec4(position.xy,0.0,1.0);}';
type Uniforms=Record<string,THREE.IUniform>;

/** A raster navigation view with cached direct-lighting; no path tracer runs
 * while the camera moves. The static renderer retains the full transport model.
 */
export class NavigationPreview {
  readonly terrain=new THREE.WebGLRenderTarget(2048,1024,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:false});
  private readonly light=new THREE.WebGLRenderTarget(512,512,{type:THREE.HalfFloatType,depthBuffer:false});
  private readonly bakeScene=new THREE.Scene();
  private readonly bakeCamera=new THREE.Camera();
  private readonly bakeMesh:THREE.Mesh;
  private readonly terrainMaterial:THREE.ShaderMaterial;
  private readonly lightMaterial:THREE.ShaderMaterial;
  private readonly scene=new THREE.Scene();
  private readonly materials:THREE.ShaderMaterial[]=[];
  private readonly meshes:THREE.Mesh[]=[];
  private terrainDirty=true;
  private lightingDirty=true;

  constructor(uniforms:Uniforms,fullscreen:THREE.BufferGeometry) {
    this.terrain.texture.wrapS=THREE.RepeatWrapping;
    this.light.texture.wrapS=THREE.RepeatWrapping;
    this.terrainMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:fullscreenVertex,fragmentShader:common+terrain,
      uniforms:{...uniforms,uAtlasResolution:{value:new THREE.Vector2(2048,1024)}}});
    this.lightMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:fullscreenVertex,fragmentShader:common+surface+geometry+light,
      uniforms:{...uniforms,uPreviewAtlasSize:{value:new THREE.Vector2(512,512)}}});
    this.bakeMesh=new THREE.Mesh(fullscreen,this.terrainMaterial);this.bakeScene.add(this.bakeMesh);
    const cylinder=new THREE.CylinderGeometry(1,1,1,384,192,true);cylinder.rotateX(Math.PI/2);
    const shapes=[cylinder,new THREE.CircleGeometry(1,384),new THREE.CircleGeometry(1,384)];
    shapes[1].translate(0,0,-0.5);shapes[2].translate(0,0,0.5);
    shapes.forEach((shape,i)=>{
      const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,side:THREE.DoubleSide,
        vertexShader:vertex,fragmentShader:common+surface+geometry+'uniform float uReferenceIlluminance;\n'+tonemap+fragment,
        uniforms:{...uniforms,uSurfaceKind:{value:i===0 ? 0 : 1},uPreviewLight:{value:this.light.texture},
          uExposure:{value:1},uAdaptive:{value:true},uWhiteBalance:{value:SOLAR_WHITE_BALANCE},
          uMaterialXYZ:{value:MATERIAL_XYZ},uLampXYZ:{value:LAMP_XYZ},uReferenceIlluminance:{value:SOLAR_ILLUMINANCE}}});
      const mesh=new THREE.Mesh(shape,material);mesh.frustumCulled=false;
      this.materials.push(material);this.meshes.push(mesh);this.scene.add(mesh);
    });
  }
  invalidate(terrainChanged:boolean,lightingChanged:boolean) {
    this.terrainDirty ||= terrainChanged;this.lightingDirty ||= lightingChanged || terrainChanged;
  }
  prepare(renderer:THREE.WebGLRenderer) {
    if(this.terrainDirty) {
      this.bakeMesh.material=this.terrainMaterial;renderer.setRenderTarget(this.terrain);renderer.render(this.bakeScene,this.bakeCamera);
      this.terrainDirty=false;
    }
    if(this.lightingDirty) {
      this.bakeMesh.material=this.lightMaterial;renderer.setRenderTarget(this.light);renderer.render(this.bakeScene,this.bakeCamera);
      this.lightingDirty=false;
    }
    renderer.setRenderTarget(null);
  }
  render(renderer:THREE.WebGLRenderer,camera:THREE.Camera,exposure:number,adaptive:boolean) {
    for(const material of this.materials) {material.uniforms.uExposure.value=exposure;material.uniforms.uAdaptive.value=adaptive;}
    renderer.setRenderTarget(null);renderer.setClearColor(0x000000);renderer.render(this.scene,camera);
  }
  dispose() {
    this.terrain.dispose();this.light.dispose();this.terrainMaterial.dispose();this.lightMaterial.dispose();
    for(const mesh of this.meshes) mesh.geometry.dispose();for(const material of this.materials) material.dispose();
  }
}
