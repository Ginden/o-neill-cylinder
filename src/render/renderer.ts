import * as THREE from 'three';
import type { Settings } from '../settings';
import { lightDirections } from '../physics';
import type { WeatherSnapshot } from '../weather/client';
import common from './shaders/common.glsl?raw';
import surface from './shaders/surface.glsl?raw';
import atmosphere from './shaders/atmosphere.glsl?raw';

export class HabitatRenderer {
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.001, 200);
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly screenCamera = new THREE.Camera();
  private weather: THREE.Data3DTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly lights = Array.from({ length: 3 }, () => new THREE.Vector3());

  constructor(readonly canvas: HTMLCanvasElement, settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.weather = new THREE.Data3DTexture(new Float32Array(4), 1, 1, 1);
    this.configureTexture(this.weather);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: false, depthWrite: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: common + surface + atmosphere,
      uniforms: {
        uRadius: { value: settings.radius }, uLength: { value: settings.length },
        uGravity: { value: settings.gravity }, uPressure: { value: settings.pressure },
        uTemperature: { value: settings.temperature + 273.15 }, uLapse: { value: settings.lapseRate },
        uWindowFraction: { value: settings.windowFraction },
        uWindowTransmission: { value: settings.windowTransmission },
        uTerrainHeight: { value: settings.terrainHeight }, uAerosol: { value: settings.aerosol },
        uAerosolG: { value: settings.aerosolG }, uSolarPower: { value: settings.solarPower },
        uLights: { value: this.lights }, uLightCount: { value: 3 },
        uAtmosphere: { value: settings.atmosphere }, uClouds: { value: settings.clouds },
        uWeather: { value: this.weather }, uInverseProjection: { value: this.camera.projectionMatrixInverse },
        uCameraMatrix: { value: this.camera.matrixWorld }, uCameraPosition: { value: this.camera.position },
        uResolution: { value: new THREE.Vector2(1, 1) }, uSteps: { value: 56 },
        uDiagnostic: { value: 0 }, uExposure: { value: settings.exposure }
      }
    });
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.apply(settings);
  }

  private configureTexture(texture: THREE.Data3DTexture) {
    texture.format = THREE.RGBAFormat;
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
  }

  apply(s: Settings) {
    const u = this.material.uniforms;
    const scalar = {
      uRadius: s.radius, uLength: s.length, uGravity: s.gravity, uPressure: s.pressure,
      uTemperature: s.temperature + 273.15, uLapse: s.lapseRate,
      uWindowFraction: s.windowFraction, uWindowTransmission: s.windowTransmission,
      uTerrainHeight: s.terrainHeight, uAerosol: s.aerosol, uAerosolG: s.aerosolG,
      uSolarPower: s.solarPower, uExposure: s.exposure,
      uAtmosphere: s.atmosphere, uClouds: s.clouds
    };
    for (const [name, value] of Object.entries(scalar)) u[name].value = value;
    const directions = lightDirections(s);
    directions.forEach((d,i) => this.lights[i].set(...d));
    u.uLightCount.value = directions.length;
    u.uSteps.value = { fast: 28, balanced: 56, high: 112 }[s.quality];
    u.uDiagnostic.value = ['natural', 'transmission', 'density', 'cloud'].indexOf(s.diagnostic);
  }

  resize(width: number, height: number, quality: Settings['quality']) {
    const scale = { fast: 0.45, balanced: 0.7, high: 1 }[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * scale);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(this.material.uniforms.uResolution.value);
  }

  render() {
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.screenCamera);
  }

  screenshot() {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose(); this.weather.dispose(); this.renderer.dispose();
  }
}
