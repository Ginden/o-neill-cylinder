import * as THREE from 'three';
import type { Settings } from '../settings';
import { backgroundAt,rayleighPerKm } from '../physics';
import { mirrorGeometry, sunDirection } from '../optics';
import { cloudMajorants } from './majorant';
import { particleOptics, PHASE_TABLE_SIZE, SPECTRAL_BINS } from './mie';
import { LAMP_RADIANCE_SCALE, SOLAR_ILLUMINANCE } from './solar';
import type { WeatherSnapshot } from '../weather/client';
import common from './shaders/common.glsl?raw';
import surface from './shaders/surface.glsl?raw';
import atmosphere from './shaders/atmosphere.glsl?raw';
import geometry from './shaders/geometry.glsl?raw';
import transport from './shaders/transport.glsl?raw';
import display from './shaders/display.glsl?raw';
import spectrum from './shaders/spectrum.glsl?raw';

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
  private readonly targets = [0,1].map(() => new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false,stencilBuffer:false}));
  private targetIndex=0;
  private readonly previousCamera = new THREE.Matrix4();
  private physicalState='';
  samples=0;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);

  constructor(readonly canvas: HTMLCanvasElement, settings: Settings) {
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
      fragmentShader: common + surface + geometry + spectrum + transport + atmosphere,
      uniforms: {
        uRadius: { value: settings.radius }, uLength: { value: settings.length },
        uGravity: { value: settings.gravity }, uPressure: { value: settings.pressure },
        uTemperature: { value: settings.temperature + 273.15 }, uLapse: { value: settings.lapseRate },
        uWindowFraction: { value: settings.windowFraction },
        uWindowTransmission: { value: settings.windowTransmission },
        uTerrainHeight: { value: settings.terrainHeight }, uAerosol: { value: settings.aerosol },
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
        uDiagnostic: { value: 0 }, uSample:{value:0},uPrevious:{value:this.targets[0].texture}
      }
    });
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.displayMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      vertexShader:'void main() { gl_Position=vec4(position.xy,0.0,1.0); }',fragmentShader:display,
      uniforms:{uImage:{value:this.targets[0].texture},uExposure:{value:settings.exposure},
        uDiagnostic:{value:0},uDisplayResolution:{value:new THREE.Vector2(1,1)}}});
    this.displayScene.add(new THREE.Mesh(this.geometry,this.displayMaterial));
    this.apply(settings);
  }

  private configureTexture(texture: THREE.Data3DTexture) {
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
  }

  setWeather(snapshot: WeatherSnapshot) {
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
    if (this.material.uniforms.uClouds.value) this.samples=0;
  }

  private updateCloudBounds() {
    const {width:x,height:y,depth:z,data}=this.weather.image;
    this.cloudBounds.dispose();
    this.cloudBounds=new THREE.Data3DTexture(cloudMajorants(data as Float32Array,[x,y,z],this.cloudExtinction),x+1,y+1,z+1);
    this.cloudBounds.format=THREE.RedFormat;
    this.configureTexture(this.cloudBounds);
    this.material.uniforms.uCloudMajorant.value=this.cloudBounds;
  }

  apply(s: Settings) {
    const u = this.material.uniforms;
    const particleState=JSON.stringify([s.aerosolRadius,s.cloudRadius]);
    if (particleState!==this.particleState) {
      const populations=[particleOptics(s.aerosolRadius,0.35,[1.5,0.01]),particleOptics(s.cloudRadius,0.35,[1.333,1e-9])];
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
    this.displayMaterial.uniforms.uExposure.value=s.exposure;
    const physicalState=JSON.stringify([scalar,particleState,s.sunAzimuth,s.sunElevation,s.mirrorTilt,s.lightMode,s.quality,s.diagnostic]);
    if (physicalState!==this.physicalState) {this.samples=0;this.physicalState=physicalState;}
  }

  resize(width: number, height: number, quality: Settings['quality']) {
    const scale = { fast: 0.45, balanced: 0.7, high: 1 }[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * scale);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(this.material.uniforms.uResolution.value);
    this.displayMaterial.uniforms.uDisplayResolution.value.copy(this.material.uniforms.uResolution.value);
    const {x,y}=this.material.uniforms.uResolution.value;
    for (const target of this.targets) target.setSize(x,y);
    this.samples=0;
  }

  render() {
    this.camera.updateMatrixWorld();
    if (!this.camera.matrixWorld.equals(this.previousCamera)) {
      this.samples=0;this.previousCamera.copy(this.camera.matrixWorld);
    }
    const previous=this.targets[this.targetIndex];
    this.targetIndex=1-this.targetIndex;
    const target=this.targets[this.targetIndex];
    this.material.uniforms.uSample.value=this.samples;
    this.material.uniforms.uPrevious.value=previous.texture;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.screenCamera);
    this.renderer.setRenderTarget(null);
    this.displayMaterial.uniforms.uImage.value=target.texture;
    this.renderer.render(this.displayScene,this.screenCamera);
    this.samples++;
  }

  screenshot() {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  luminance() {
    const target=this.targets[this.targetIndex];
    const pixels=new Float32Array(5*5*4);
    this.renderer.readRenderTargetPixels(target,Math.floor(target.width/2)-2,Math.floor(target.height/2)-2,5,5,pixels);
    let sum=0;
    for (let i=1;i<pixels.length;i+=4) sum+=pixels[i];
    return sum/25*SOLAR_ILLUMINANCE;
  }

  get clearAirBlueExtinction() {
    return rayleighPerKm(440)+this.material.uniforms.uAerosol.value*this.aerosolBlueRatio;
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose();this.displayMaterial.dispose();
    for (const target of this.targets) target.dispose();
    this.weather.dispose();this.cloudBounds.dispose(); this.renderer.dispose();
    for (const texture of this.particleTextures) texture.dispose();
  }
}
