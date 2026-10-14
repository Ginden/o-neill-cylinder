import * as THREE from 'three';
import common from './shaders/common.glsl?raw';
import landscape from './shaders/landscape.glsl?raw';
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

/** Ground atlas size: roughly square texels, at most `limit` on a side. Both
 * sides are multiples of 32, so each occupancy mip texel covers exactly the
 * 2^level × 2^level base texels below it. */
export function atlasSize(radius:number,length:number,limit:number):[number,number] {
  const height=Math.round(limit*Math.min(1,length/(2*Math.PI*radius))/32)*32;
  return [limit,Math.max(256,height)];
}

/** A raster navigation view of the wall and endcaps; no camera paths are traced
 * while the camera moves. Direct sunlight is baked analytically; the renderer
 * supplies the light that has scattered or reflected at least once, traced into
 * the same surface atlas (`uSurfaceLight`). It also bakes the shared terrain
 * height and land-cover atlases.
 */
export class NavigationPreview {
  readonly terrain=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:false});
  // Half-precision copy at half resolution for standing trees and houses.
  readonly anchors=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,format:THREE.RedFormat,depthBuffer:false});
  // Mip levels of the occupancy channel let rays skip land without trees or houses.
  readonly cover=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,generateMipmaps:true,
    minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter});
  // Direct sunlight in the surface atlas layout (geometry.glsl): wall and endcaps.
  private readonly light=new THREE.WebGLRenderTarget(512,768,{type:THREE.HalfFloatType,depthBuffer:false});
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
    for (const target of [this.terrain,this.anchors,this.cover,this.light]) target.texture.wrapS=THREE.RepeatWrapping;
    // The bake must not sample the targets it writes.
    this.terrainMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:fullscreenVertex,fragmentShader:common+landscape+terrain,
      uniforms:{...uniforms,uTerrain:{value:null},uAnchorTerrain:{value:null},uLandCover:{value:null},
        uAtlasResolution:{value:new THREE.Vector2(1,1)},uBakeCover:{value:false}}});
    this.lightMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:fullscreenVertex,fragmentShader:common+landscape+surface+geometry+light,
      uniforms:{...uniforms,uPreviewAtlasSize:{value:new THREE.Vector2(this.light.width,this.light.height)}}});
    this.bakeMesh=new THREE.Mesh(fullscreen,this.terrainMaterial);this.bakeScene.add(this.bakeMesh);
    const cylinder=new THREE.CylinderGeometry(1,1,1,384,192,true);cylinder.rotateX(Math.PI/2);
    const shapes=[cylinder,new THREE.CircleGeometry(1,384),new THREE.CircleGeometry(1,384)];
    shapes[1].translate(0,0,-0.5);shapes[2].translate(0,0,0.5);
    shapes.forEach((shape,i)=>{
      const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,side:THREE.DoubleSide,
        vertexShader:vertex,fragmentShader:common+landscape+surface+geometry+'uniform float uReferenceIlluminance;\n'+tonemap+fragment,
        uniforms:{...uniforms,uSurfaceKind:{value:i===0 ? 0 : 1},uPreviewLight:{value:this.light.texture},
          uExposure:{value:1},uAdaptive:{value:true},uWhiteBalance:{value:SOLAR_WHITE_BALANCE},
          uMaterialXYZ:{value:MATERIAL_XYZ},uLampXYZ:{value:LAMP_XYZ},uReferenceIlluminance:{value:SOLAR_ILLUMINANCE}}});
      const mesh=new THREE.Mesh(shape,material);mesh.frustumCulled=false;
      this.materials.push(material);this.meshes.push(mesh);this.scene.add(mesh);
    });
  }
  /** Resize both ground atlases; their contents are rebaked on the next frame. */
  resizeAtlas(width:number,height:number) {
    if (this.terrain.width===width && this.terrain.height===height) return;
    this.terrain.setSize(width,height);this.anchors.setSize(width/2,height/2);this.cover.setSize(width,height);this.terrainDirty=true;
  }
  invalidate(terrainChanged:boolean,lightingChanged:boolean) {
    this.terrainDirty ||= terrainChanged;this.lightingDirty ||= lightingChanged || terrainChanged;
  }
  prepare(renderer:THREE.WebGLRenderer) {
    if(this.terrainDirty) {
      const u=this.terrainMaterial.uniforms;
      this.bakeMesh.material=this.terrainMaterial;
      for (const [target,cover] of [[this.terrain,false],[this.anchors,false],[this.cover,true]] as const) {
        u.uBakeCover.value=cover;u.uAtlasResolution.value.set(target.width,target.height);
        renderer.setRenderTarget(target);renderer.render(this.bakeScene,this.bakeCamera);
      }
      this.terrainDirty=false;this.lightingDirty=true;
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
    this.terrain.dispose();this.anchors.dispose();this.cover.dispose();this.light.dispose();this.terrainMaterial.dispose();this.lightMaterial.dispose();
    for(const mesh of this.meshes) mesh.geometry.dispose();for(const material of this.materials) material.dispose();
  }
}
