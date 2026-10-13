import * as THREE from 'three';
import type { Settings } from '../settings';
import { backgroundAt,rayleighPerKm } from '../physics';
import { mirrorGeometry, sunDirection } from '../optics';
import { cloudMajorants } from './majorant';
import { particleOptics, PHASE_TABLE_SIZE, SPECTRAL_BINS } from './mie';
import type { Populations } from './particles';
import { LAMP_RADIANCE_SCALE, SOLAR_ILLUMINANCE } from './solar';
import type { WeatherSnapshot } from '../weather/client';
import common from './shaders/common.glsl?raw';
import landscape from './shaders/landscape.glsl?raw';
import surface from './shaders/surface.glsl?raw';
import atmosphere from './shaders/atmosphere.glsl?raw';
import geometry from './shaders/geometry.glsl?raw';
import transport from './shaders/transport.glsl?raw';
import display from './shaders/display.glsl?raw';
import tonemap from './shaders/tonemap.glsl?raw';
import { SOLAR_WHITE_BALANCE } from './color';
import spectrum from './shaders/spectrum.glsl?raw';
import guides from './shaders/guides.glsl?raw';
import { atlasSize,NavigationPreview } from './preview';
import { DisplayDenoiser,ExposureMeter } from './postprocess';

export class HabitatRenderer {
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.001, 200);
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly screenCamera = new THREE.Camera();
  private weather: THREE.Data3DTexture;
  private cloudBounds: THREE.Data3DTexture;
  private readonly particleTextures=[0,1].map(()=>new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType));
  private particleState='';
  private cloudExtinction=150000;
  private aerosolExtinction=1;
  private aerosolBlueRatio=1;
  private readonly material: THREE.ShaderMaterial;
  private readonly displayMaterial: THREE.ShaderMaterial;
  private readonly displayScene = new THREE.Scene();
  private readonly targets = [0,1].map(() => new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.FloatType,depthBuffer:false,stencilBuffer:false}));
  private targetIndex=0;
  private band=0;
  private bands=1;
  get sampleInProgress() { return this.band>0; }
  private readonly previousCamera = new THREE.Matrix4();
  private physicalState='';
  private terrainState='';
  private readonly preview:NavigationPreview;
  private readonly denoiser:DisplayDenoiser;
  private readonly guideTarget=new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.FloatType,depthBuffer:false});
  private readonly guideScene=new THREE.Scene();
  private readonly guideMaterial:THREE.ShaderMaterial;
  private guidesDirty=true;
  private denoise=true;
  private adaptiveExposure=true;
  private exposure=1;
  private lastDisplayTime=performance.now();
  private readonly exposureMeter:ExposureMeter;
  private lastMovement=0;
  private frameFence:WebGLSync|null=null;
  private meterBusy=false;
  private meterValue:number|null=null;
  private revision=0;
  private weatherRevision=-1;
  private liveWeather=false;
  private cloudMass=0;
  mode:'preview'|'path'='preview';
  samples=0;
  raySize='';
  private readonly geometry = new THREE.PlaneGeometry(2, 2);

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas, settings: Settings, populations?: Populations) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Floating-point render targets are required for physical light accumulation.');
    this.weather = new THREE.Data3DTexture(new Float32Array(4), 1, 1, 1);
    this.configureTexture(this.weather);
    this.cloudBounds = new THREE.Data3DTexture(new Float32Array(8),2,2,2);
    this.cloudBounds.format=THREE.RedFormat;
    this.configureTexture(this.cloudBounds);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: false, depthWrite: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: common + landscape + surface + geometry + spectrum + transport + atmosphere,
      uniforms: {
        uRadius: { value: settings.radius }, uLength: { value: settings.length },
        uGravity: { value: settings.gravity }, uPressure: { value: settings.pressure },
        uTemperature: { value: settings.temperature + 273.15 }, uLapse: { value: settings.lapseRate },
        uWindowFraction: { value: settings.windowFraction },
        uWindowTransmission: { value: settings.windowTransmission },
        uTerrainHeight: { value: settings.terrainHeight }, uAerosol: { value: settings.aerosol },
        uTerrain:{value:null},uAnchorTerrain:{value:null},uCachedTerrain:{value:true},uLandCover:{value:null},uLandUse:{value:true},
        uSolarPower: { value: settings.solarPower },
        uAerosolPhase:{value:this.particleTextures[0]},uCloudPhase:{value:this.particleTextures[1]},
        uAerosolScale:{value:1},uReferenceIlluminance:{value:SOLAR_ILLUMINANCE},uLampScale:{value:LAMP_RADIANCE_SCALE},
        uSun: {value: new THREE.Vector3()},uMirrorCount:{value:0},
        uMirrorCenter:{value:Array.from({length:3},()=>new THREE.Vector3())},
        uMirrorNormal:{value:Array.from({length:3},()=>new THREE.Vector3())},
        uMirrorAcross:{value:Array.from({length:3},()=>new THREE.Vector3())},
        uMirrorAlong:{value:Array.from({length:3},()=>new THREE.Vector3())},
        uMirrorSize:{value:new THREE.Vector2()},uMirrorReflectivity:{value:settings.mirrorReflectivity},
        uAirMajorant:{value:0},uCloudMajorant:{value:this.cloudBounds},
        uAtmosphere: { value: settings.atmosphere }, uClouds: { value: settings.clouds },
        uWeather: { value: this.weather }, uInverseProjection: { value: this.camera.projectionMatrixInverse },
        uCameraMatrix: { value: this.camera.matrixWorld }, uCameraPosition: { value: this.camera.position },
        uResolution: { value: new THREE.Vector2(1, 1) }, uSteps: { value: 56 },
        uDiagnostic: { value: 0 }, uSample:{value:0},uHistory:{value:0},uPrevious:{value:this.targets[0].textures[0]},uPreviousHaze:{value:this.targets[0].textures[1]}
      }
    });
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.displayMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main() { gl_Position=vec4(position.xy,0.0,1.0); }',fragmentShader:'uniform float uReferenceIlluminance;\n'+tonemap+display,
      uniforms:{uImage:{value:this.targets[0].textures[0]},uExposure:{value:settings.exposure},
        uAdaptive:{value:settings.adaptiveExposure},uWhiteBalance:{value:SOLAR_WHITE_BALANCE},uReferenceIlluminance:{value:SOLAR_ILLUMINANCE},
        uDiagnostic:{value:0},uDisplayResolution:{value:new THREE.Vector2(1,1)}}});
    this.displayScene.add(new THREE.Mesh(this.geometry,this.displayMaterial));
    this.preview=new NavigationPreview(this.material.uniforms,this.geometry);
    this.material.uniforms.uTerrain.value=this.preview.terrain.texture;
    this.material.uniforms.uAnchorTerrain.value=this.preview.anchors.texture;
    this.material.uniforms.uLandCover.value=this.preview.cover.texture;
    this.denoiser=new DisplayDenoiser(this.geometry);
    this.exposureMeter=new ExposureMeter(this.geometry);
    this.guideMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:common+landscape+surface+geometry+guides,uniforms:this.material.uniforms});
    this.guideScene.add(new THREE.Mesh(this.geometry,this.guideMaterial));
    this.apply(settings,populations);
  }

  private configureTexture(texture: THREE.Data3DTexture) {
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
  }

  setWeather(snapshot: WeatherSnapshot) {
    this.cloudMass=snapshot.stats.cloudMass;
    const [x,y,z] = snapshot.dimensions;
    if (this.weather.image.width !== x) {
      this.weather.dispose();
      this.weather = new THREE.Data3DTexture(snapshot.data, x, y, z);
      this.configureTexture(this.weather);
      this.material.uniforms.uWeather.value = this.weather;
    } else {
      this.weather.image.data = snapshot.data;
      this.weather.needsUpdate = true;
    }
    this.updateCloudBounds();
    if (this.material.uniforms.uClouds.value && (!this.liveWeather || snapshot.revision!==this.weatherRevision)) this.resetAccumulation();
    this.weatherRevision=snapshot.revision;
  }

  private updateCloudBounds() {
    const {width:x,height:y,depth:z,data}=this.weather.image;
    this.cloudBounds.dispose();
    this.cloudBounds=new THREE.Data3DTexture(cloudMajorants(data as Float32Array,[x,y,z],this.cloudExtinction),x+1,y+1,z+1);
    this.cloudBounds.format=THREE.RedFormat;
    this.configureTexture(this.cloudBounds);
    this.material.uniforms.uCloudMajorant.value=this.cloudBounds;
  }

  apply(s: Settings, preparedPopulations?: Populations) {
    const u = this.material.uniforms;
    const liveWeather=s.clouds && !s.paused && s.pressure>0;
    // A paused image must converge to the final field, without moving-weather
    // history. Ordinary live snapshots retain history instead of restarting it.
    if (this.liveWeather && !liveWeather) this.resetAccumulation();
    else if (!this.liveWeather && liveWeather) this.band=0; // Reweight every band consistently on resume.
    this.liveWeather=liveWeather;
    const particleState=JSON.stringify([s.aerosolRadius,s.cloudRadius]);
    if (particleState!==this.particleState) {
      const populations=preparedPopulations ?? [particleOptics(s.aerosolRadius,0.35,[1.5,0.01]),particleOptics(s.cloudRadius,0.35,[1.333,1e-9])];
      populations.forEach((population,i)=>{
        this.particleTextures[i].dispose();
        const texture=new THREE.DataTexture(population.data,PHASE_TABLE_SIZE,SPECTRAL_BINS,THREE.RGBAFormat,THREE.FloatType);
        texture.needsUpdate=true;this.particleTextures[i]=texture;
        const name=i===0 ? 'Aerosol' : 'Cloud';
        u[`u${name}Phase`].value=texture;
      });
      u.uAerosolScale.value=1/populations[0].greenExtinction;
      this.aerosolExtinction=populations[0].maximumExtinction/populations[0].greenExtinction;
      this.aerosolBlueRatio=populations[0].data[6*PHASE_TABLE_SIZE*4+2]/populations[0].greenExtinction;
      this.cloudExtinction=populations[1].maximumExtinction;
      this.updateCloudBounds();this.particleState=particleState;
    }
    const scalar = {
      uRadius: s.radius, uLength: s.length, uGravity: s.gravity, uPressure: s.pressure,
      uTemperature: s.temperature + 273.15, uLapse: s.lapseRate,
      uWindowFraction: s.windowFraction, uWindowTransmission: s.windowTransmission,
      uTerrainHeight: s.terrainHeight, uAerosol: s.aerosol,
      uSolarPower: s.solarPower,uMirrorReflectivity:s.mirrorReflectivity,
      uAtmosphere: s.atmosphere, uClouds: s.clouds
    };
    for (const [name, value] of Object.entries(scalar)) u[name].value = value;
    u.uSun.value.set(...sunDirection(s));
    const panels=mirrorGeometry(s);
    panels.forEach((panel,i)=>{
      for (const [name,key] of [['uMirrorCenter','center'],['uMirrorNormal','normal'],['uMirrorAcross','across'],['uMirrorAlong','along']] as const) {
        u[name].value[i].set(...panel[key]);
      }
    });
    u.uMirrorSize.value.set(panels[0].halfWidth,panels[0].halfLength);
    u.uMirrorCount.value=s.lightMode==='mirrors' ? 3 : 0;
    const density=Math.max(...[0,s.radius].map(r=>{
      const b=backgroundAt(r,s);return b.pressure/101325*288.15/b.temperature;
    }));
    u.uAirMajorant.value=(0.063+s.aerosol*this.aerosolExtinction)*density*1.0001;
    u.uSteps.value = { fast: 28, balanced: 56, high: 112 }[s.quality];
    u.uDiagnostic.value = ['natural', 'transmission', 'density', 'cloud'].indexOf(s.diagnostic);
    this.displayMaterial.uniforms.uDiagnostic.value=u.uDiagnostic.value;
    this.exposure=s.exposure;this.adaptiveExposure=s.adaptiveExposure;
    this.displayMaterial.uniforms.uAdaptive.value=s.adaptiveExposure;
    this.denoise=s.denoise;
    const terrainState=JSON.stringify([s.radius,s.length,s.terrainHeight,s.windowFraction,s.quality]);
    if (terrainState!==this.terrainState) this.preview.resizeAtlas(...atlasSize(s.radius,s.length,s.quality==='fast' ? 2048 : 4096));
    const physicalState=JSON.stringify([scalar,particleState,s.sunAzimuth,s.sunElevation,s.mirrorTilt,s.lightMode,s.quality,s.diagnostic]);
    this.preview.invalidate(terrainState!==this.terrainState,physicalState!==this.physicalState);
    this.terrainState=terrainState;
    if (physicalState!==this.physicalState) {this.resetAccumulation();this.physicalState=physicalState;}
  }

  private resetAccumulation() {this.samples=0;this.band=0;this.meterValue=null;this.exposureMeter.invalidate();this.guidesDirty=true;this.revision++;}

  resize(width: number, height: number, quality: Settings['quality'], pixelRatio=globalThis.devicePixelRatio ?? 1) {
    const scale = { fast: 0.5, balanced: 1, high: 1 }[quality];
    this.renderer.setPixelRatio(Math.min(pixelRatio, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.displayMaterial.uniforms.uDisplayResolution.value.copy(size);
    const budget={fast:196608,balanced:1048576,high:4194304}[quality];
    const reduction=Math.min(1,Math.sqrt(budget/(size.x*size.y*scale*scale)));
    const x=Math.max(16,Math.floor(size.x*scale*reduction)),y=Math.max(16,Math.floor(size.y*scale*reduction));
    this.bands=Math.ceil(x*y/196608);
    this.material.uniforms.uResolution.value.set(x,y);
    for (const target of this.targets) target.setSize(x,y);
    this.guideTarget.setSize(x,y);this.denoiser.resize(x,y);
    this.resetAccumulation();this.raySize=`${x}×${y}`;
  }

  render(interacting=false) {
    const now=performance.now();
    this.exposureMeter.adaptation.update((now-this.lastDisplayTime)/1000);this.lastDisplayTime=now;
    const exposure=this.exposure*(this.adaptiveExposure ? this.exposureMeter.adaptation.exposure(SOLAR_ILLUMINANCE) : 1);
    this.displayMaterial.uniforms.uExposure.value=exposure;
    this.camera.updateMatrixWorld();
    const changed=!this.camera.matrixWorld.equals(this.previousCamera);
    if (changed) {
      this.resetAccumulation();this.previousCamera.copy(this.camera.matrixWorld);
    }
    if(changed || interacting) this.lastMovement=performance.now();
    const gl=this.renderer.getContext() as WebGL2RenderingContext;
    if(this.frameFence) {
      // Even a display-only draw queues behind unfinished tracing. Never build
      // a GPU backlog: the preserved canvas already contains the last image.
      if(gl.clientWaitSync(this.frameFence,0,0)===gl.TIMEOUT_EXPIRED) return false;
      gl.deleteSync(this.frameFence);this.frameFence=null;
    }
    this.preview.prepare(this.renderer);
    this.mode=interacting || performance.now()-this.lastMovement<200 ? 'preview' : 'path';
    if(this.mode==='preview') {
      this.preview.render(this.renderer,this.camera,exposure,this.adaptiveExposure);
      this.frameFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
      return true;
    }
    const previous=this.targets[this.targetIndex];
    const target=this.targets[1-this.targetIndex];
    const bottom=Math.floor(this.band*target.height/this.bands);
    const top=Math.floor((this.band+1)*target.height/this.bands);
    // Keep individual GPU submissions small enough for input and compositing.
    // Only complete samples become visible or participate in accumulation.
    for (const output of [target,this.guideTarget]) {
      output.scissorTest=true;output.scissor.set(0,bottom,target.width,top-bottom);
    }
    if(this.guidesDirty && this.material.uniforms.uDiagnostic.value===0) {
      this.renderer.setRenderTarget(this.guideTarget);this.renderer.render(this.guideScene,this.screenCamera);
    }
    this.material.uniforms.uSample.value=this.samples;
    // Keep the spectral sequence advancing after the temporal weight saturates.
    // A 1/32 update weight smooths live weather; static scenes use the exact mean.
    const history=this.liveWeather ? Math.min(this.samples,31) : this.samples;
    this.material.uniforms.uHistory.value=history;
    this.material.uniforms.uPrevious.value=previous.textures[0];
    this.material.uniforms.uPreviousHaze.value=previous.textures[1];
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.screenCamera);
    this.renderer.setRenderTarget(null);
    if (++this.band<this.bands) {
      this.frameFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
      return false;
    }
    this.band=0;this.targetIndex=1-this.targetIndex;this.guidesDirty=false;
    this.displayMaterial.uniforms.uImage.value=this.denoise && this.material.uniforms.uDiagnostic.value===0
      ? this.denoiser.filter(this.renderer,target,this.guideTarget,history+1,this.material.uniforms.uClouds.value && this.cloudMass>0) : target.textures[0];
    if(this.adaptiveExposure && this.material.uniforms.uDiagnostic.value===0 && (this.samples+1)%8===0)
      this.exposureMeter.measure(this.renderer,target.textures[0]);
    this.renderer.render(this.displayScene,this.screenCamera);
    this.samples++;
    this.frameFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
    return true;
  }

  luminance() {
    if(this.mode==='preview' || this.samples===0) return null;
    if(this.meterBusy) return this.meterValue;
    this.meterBusy=true;
    const revision=this.revision;
    const target=this.targets[this.targetIndex];
    const pixels=new Float32Array(5*5*4);
    void this.renderer.readRenderTargetPixelsAsync(target,Math.floor(target.width/2)-2,Math.floor(target.height/2)-2,5,5,pixels)
      .then(()=>{
        if(revision!==this.revision) return;
        let sum=0;for(let i=1;i<pixels.length;i+=4) sum+=pixels[i];
        this.meterValue=sum/25*SOLAR_ILLUMINANCE;
      }).finally(()=>{this.meterBusy=false;});
    return this.meterValue;
  }

  get clearAirBlueExtinction() {
    return rayleighPerKm(440)+this.material.uniforms.uAerosol.value*this.aerosolBlueRatio;
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose();this.displayMaterial.dispose();
    for (const target of this.targets) target.dispose();
    this.weather.dispose();this.cloudBounds.dispose();
    for (const texture of this.particleTextures) texture.dispose();
    this.preview.dispose();this.denoiser.dispose();this.exposureMeter.dispose();this.guideTarget.dispose();this.guideMaterial.dispose();
    if(this.frameFence) (this.renderer.getContext() as WebGL2RenderingContext).deleteSync(this.frameFence);
    this.renderer.dispose();
  }
}
