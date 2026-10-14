import { expect, test } from '@playwright/test';
import { openIsolatedPage } from './isolated';

// Noisy fog in front of varied, invisible geometry: crowns, panes and terrain
// at different depths and normals behind an opaque medium.
test('filters noisy fog without inheriting hidden surface edges', async ({ page }) => {
  await openIsolatedPage(page);
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/three/build/three.module.js', filterModule = '/src/render/postprocess.ts';
    const THREE = await import(threeModule), { DisplayDenoiser } = await import(filterModule);
    const size = 96, samples = 32, length = size * size * 4, fog = [0.031, 0.03, 0.033];
    const total = new Float32Array(length), haze = new Float32Array(length), geometry = new Float32Array(length);
    const albedo = new Float32Array(length), medium = new Float32Array(length);
    // Deterministic noise: luminance ±40 %, color ±10 %, like a few four-wavelength samples.
    let seed = 12345;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let inputSpread = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (x + y * size) * 4;
      geometry.set([x % 3 === 0 ? 1 : 0, 0, x % 3 === 0 ? 0 : 1, x % 3 === 0 ? 8 : y % 2 === 0 ? 2 : 15], i);
      albedo.set([0.1, 0.4, 0.04, x % 3 === 0 ? 3 : 4], i);
      medium.set([0.08, 0, 0, 1], i);
      const scale = 1 + 0.8 * (random() - 0.5), color = fog.map(value => value * scale * (1 + 0.2 * (random() - 0.5)));
      inputSpread += (scale - 1) ** 2;
      // Second moment of the samples: their spread around the mean.
      const moment = color[1] ** 2 + (0.4 * fog[1]) ** 2 * samples / 3;
      total.set([...color, 0], i);
      haze.set([...color, moment], i);
    }
    const textures = [total, haze, geometry, albedo, medium].map(data => {
      const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
      texture.needsUpdate = true; return texture;
    });
    const renderer = new THREE.WebGLRenderer(), plane = new THREE.PlaneGeometry(2, 2), filter = new DisplayDenoiser(plane);
    filter.resize(size, size);
    const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, depthBuffer: false });
    const material = new THREE.ShaderMaterial({
      uniforms: { image: { value: null } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}',
      fragmentShader: 'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}'
    });
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(plane, material));
    const read = () => {
      material.uniforms.image.value = filter.filter(renderer, { textures: textures.slice(0, 2) }, { textures: textures.slice(2) }, samples);
      renderer.setRenderTarget(target); renderer.render(scene, new THREE.Camera());
      const data = new Float32Array(length); renderer.readRenderTargetPixels(target, 0, 0, size, size, data); return data;
    };
    const actual = read();
    // Moving completely obscured geometry cannot change the fog reconstruction.
    for (let i = 3; i < geometry.length; i += 4) geometry[i] = 4;
    for (let i = 0; i < geometry.length; i += 4) geometry.set([0, 0, 1], i);
    textures[2].needsUpdate = true;
    const flat = read();
    let maximumGeometryDifference = 0, maximumColorError = 0, spread = 0, count = 0;
    for (let y = 16; y < size - 16; y++) for (let x = 16; x < size - 16; x++) {
      const i = (x + y * size) * 4;
      spread += (actual[i + 1] / fog[1] - 1) ** 2; count++;
      for (const c of [0, 1, 2]) {
        maximumGeometryDifference = Math.max(maximumGeometryDifference, Math.abs(actual[i + c] - flat[i + c]));
        maximumColorError = Math.max(maximumColorError, Math.abs(actual[i + c] / actual[i + 1] - fog[c] / fog[1]) / (fog[c] / fog[1]));
      }
    }
    const error = renderer.getContext().getError();
    filter.dispose(); target.dispose(); material.dispose(); plane.dispose(); textures.forEach(texture => texture.dispose()); renderer.dispose();
    return { maximumGeometryDifference, maximumColorError, inputSpread: Math.sqrt(inputSpread / (size * size)), outputSpread: Math.sqrt(spread / count), error };
  });
  await test.info().attach('fog-filter-metrics', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.error).toBe(0);
  expect(result.maximumGeometryDifference).toBeLessThan(1e-6);
  expect(result.outputSpread).toBeLessThan(result.inputSpread * 0.4);
  expect(result.maximumColorError).toBeLessThan(0.08);
});

test('cloud filtering depth follows Beer–Lambert visibility instead of obscured geometry', async ({ page }) => {
  await openIsolatedPage(page);
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/three/build/three.module.js', THREE = await import(threeModule);
    const source = (await Promise.all(['common', 'landscape', 'surface', 'geometry', 'guides'].map(name =>
      fetch(`/src/render/shaders/${name}.glsl`).then(response => response.text())))).join('\n').replace('void main()', 'void guideMain()');
    const weather = new THREE.Data3DTexture(new Float32Array([0.00002, 0, 0, 0]), 1, 1, 1);
    weather.type = THREE.FloatType; weather.needsUpdate = true;
    const phaseData = new Float32Array(41 * 4);
    for (let i = 0; i < 41; i++) phaseData[i * 4 + 2] = 100000;
    const phase = new THREE.DataTexture(phaseData, 1, 41, THREE.RGBAFormat, THREE.FloatType); phase.needsUpdate = true;
    const renderer = new THREE.WebGLRenderer(), target = new THREE.WebGLRenderTarget(4, 1, { count: 3, type: THREE.FloatType, depthBuffer: false });
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      uniforms: { uAtmosphere: { value: true }, uClouds: { value: true }, uPressure: { value: 1013 }, uRadius: { value: 4 }, uLength: { value: 24 },
        uWeather: { value: weather }, uCloudPhase: { value: phase }, uCameraPosition: { value: new THREE.Vector3() } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader: source + `
        void main(){
          float distance=gl_FragCoord.x<1.0 ? 0.0 : gl_FragCoord.x<2.0 ? 0.25 : gl_FragCoord.x<3.0 ? 4.0 : 20.0;
          outGeometry=vec4(cloudDepth(vec3(0,0,1),distance),0,0,1);outAlbedo=vec4(0);outMedium=vec4(0);
        }`
    });
    const plane = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene(); scene.add(new THREE.Mesh(plane, material));
    const read = () => {
      renderer.setRenderTarget(target); renderer.render(scene, new THREE.Camera());
      const data = new Float32Array(16); renderer.readRenderTargetPixels(target, 0, 0, 4, 1, data);
      return [data[0], data[4], data[8], data[12]];
    };
    const cloudy = read(); material.uniforms.uClouds.value = false; const clear = read();
    const error = renderer.getContext().getError();
    material.dispose(); plane.dispose(); target.dispose(); phase.dispose(); weather.dispose(); renderer.dispose();
    return { cloudy, clear, error };
  });
  expect(result.error).toBe(0);
  for (const [i, distance] of [0, 0.25, 4, 20].entries()) {
    expect(result.cloudy[i]).toBeCloseTo((1 - Math.exp(-2 * distance)) / 2, 3);
    expect(result.clear[i]).toBeCloseTo(distance, 5);
  }
});
