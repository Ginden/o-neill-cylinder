/* global console, document, performance, setTimeout, MessageChannel */
// Pass-level GPU timings, cold shader compile times and two atlas checks, on a real GPU.
// Usage (dev server running on 5173, nothing else using the GPU):
//   node scripts/profile-gpu.mjs compile|perf|extra|correct
// One renderer, banded draws only; each mode runs for well under two minutes.
import { chromium } from '@playwright/test';

const mode = process.argv[2] ?? 'perf';
if (!['compile', 'perf', 'extra', 'correct'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: (process.env.BENCHMARK_GPU_ARGS ?? '').split(' ').filter(Boolean)
});
try {
  const page = await browser.newPage({ viewport: { width: 940, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error('pageerror', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route(/\/(?:src\/main\.ts(?:\?.*)?|@vite\/client)$/, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto(process.env.BENCHMARK_URL ?? 'http://127.0.0.1:5173/');
  const result = await page.evaluate(async mode => {
    const { HabitatRenderer } = await import('/src/render/renderer.ts');
    const { defaults } = await import('/src/settings.ts');
    const { Navigation } = await import('/src/render/navigation.ts');
    const { WeatherSolver } = await import('/src/weather/solver.ts');
    const { paneRouteSources } = await import('/src/optics.ts');
    const W = 940, H = 800;
    function requireFields(habitat) {
      const fields = {
        '': 'renderer preview camera canvas scene screenCamera material targets guideScene guideMaterial guideTarget diffusionScene diffusionMaterial cacheTargets displayScene displayMaterial denoiser exposureMeter surfaceTargets surfaceIndex surfaceSample cacheIteration band bands raySize samples mode resetAccumulation resetSurface',
        preview: 'bakeScene bakeCamera terrainMaterial terrain lightMaterial light bakeMesh scene materials prepare invalidate',
        denoiser: 'scene camera material targets', exposureMeter: 'scene camera material target'
      };
      for (const [prefix, names] of Object.entries(fields)) for (const name of names.split(' ')) {
        const owner = prefix ? habitat[prefix] : habitat;
        if (owner?.[name] === undefined) throw new Error(`Profiler needs renderer field ${prefix ? prefix + '.' : ''}${name}`);
      }
    }
    const makeCanvas = () => {
      const canvas = document.createElement('canvas');
      document.body.replaceChildren(canvas); document.body.style.margin = '0';
      canvas.style.cssText = `width:${W}px;height:${H}px`;
      return canvas;
    };
    const timerTick = () => new Promise(resolve => setTimeout(resolve, 0));
    const channel = new MessageChannel();
    let wake = null;
    channel.port1.onmessage = () => { const w = wake; wake = null; w?.(); };
    const channelTick = () => new Promise(resolve => { wake = resolve; channel.port2.postMessage(0); });
    const gpuName = gl => {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    };

    if (mode === 'compile') {
      async function timings(parallel, nonce) {
        const settings = { ...defaults, paused: true };
        let t = performance.now();
        const habitat = new HabitatRenderer(makeCanvas(), settings);
        requireFields(habitat);
        const constructMs = performance.now() - t;
        habitat.resize(W, H, 'balanced', 1);
        const r = habitat.renderer, gl = r.getContext(), p = habitat.preview;
        // A changed constant survives translation, unlike a comment or an unused function.
        const marker = 'const float SECTOR_ANGLE = 2.0943951023931953;';
        const inject = material => {
          if (!material.fragmentShader.includes(marker)) return;
          material.fragmentShader = material.fragmentShader.replace(marker, `const float SECTOR_ANGLE = ${(2.0943951023931953 + nonce * 1e-7).toFixed(10)};`);
          material.needsUpdate = true;
        };
        const jobs = [
          ['terrain bake', p.bakeScene, p.bakeCamera, p.terrainMaterial, p.terrain, () => { p.bakeMesh.material = p.terrainMaterial; }],
          ['sun bake', p.bakeScene, p.bakeCamera, p.lightMaterial, p.light, () => { p.bakeMesh.material = p.lightMaterial; }],
          ['raster preview', p.scene, habitat.camera, p.materials[0], null],
          ['guides', habitat.guideScene, habitat.screenCamera, habitat.guideMaterial, habitat.guideTarget],
          ['path tracer', habitat.scene, habitat.screenCamera, habitat.material, habitat.targets[0]],
          ['cache diffusion', habitat.diffusionScene, habitat.screenCamera, habitat.diffusionMaterial, habitat.cacheTargets[0]],
          ['denoiser', habitat.denoiser.scene, habitat.denoiser.camera, habitat.denoiser.material, habitat.denoiser.targets[0]],
          ['display', habitat.displayScene, habitat.screenCamera, habitat.displayMaterial, null],
          ['meter', habitat.exposureMeter.scene, habitat.exposureMeter.camera, habitat.exposureMeter.material, habitat.exposureMeter.target]
        ];
        for (const material of [p.terrainMaterial, p.lightMaterial, ...p.materials, habitat.guideMaterial, habitat.material]) inject(material);
        const rows = {}, programs = [];
        const start = performance.now();
        for (const [name, scene, camera, material, target, setup] of jobs) {
          setup?.();
          r.setRenderTarget(target);
          t = performance.now();
          r.compile(scene, camera);
          const program = r.properties.get(material).currentProgram.program;
          const submitMs = performance.now() - t;
          if (parallel) { programs.push([name, program, submitMs]); continue; }
          gl.getProgramParameter(program, gl.LINK_STATUS);
          rows[name] = { ms: +(performance.now() - t).toFixed(0), submitMs: +submitMs.toFixed(1), sourceChars: material.fragmentShader.length };
        }
        const submittedMs = performance.now() - start;
        for (const [name, program, submitMs] of programs) {
          gl.getProgramParameter(program, gl.LINK_STATUS);
          rows[name] = { readyAtMs: +(performance.now() - start).toFixed(0), submitMs: +submitMs.toFixed(1) };
        }
        const totalMs = performance.now() - start;
        r.setRenderTarget(null);
        const out = { parallel, gpu: gpuName(gl), parallelExtension: !!gl.getExtension('KHR_parallel_shader_compile'),
          constructMs: +constructMs.toFixed(0), submittedMs: +submittedMs.toFixed(0), totalMs: +totalMs.toFixed(0), rows };
        habitat.dispose();
        return out;
      }
      const nonce = 1 + Math.floor(Math.random() * 400);
      return [await timings(false, nonce), await timings(true, nonce + 500)];
    }

    const settings = { ...defaults, paused: true };
    const habitat = new HabitatRenderer(makeCanvas(), settings);
        requireFields(habitat);
    const nav = new Navigation(habitat.camera, habitat.canvas, settings);
    habitat.resize(W, H, settings.quality, 1);
    const gl = habitat.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const original = habitat.renderer.render.bind(habitat.renderer);
    let queries = null;
    const tagOf = scene => {
      const u = habitat.material.uniforms;
      if (scene === habitat.scene) return u.uCachePass.value ? 'cache' : u.uSurfacePass.value ? 'surface' : 'camera';
      if (scene === habitat.guideScene) return 'guide';
      if (scene === habitat.diffusionScene) return 'diffusion';
      if (scene === habitat.displayScene) return 'display';
      if (scene === habitat.denoiser.scene) return 'denoise';
      if (scene === habitat.exposureMeter.scene) return 'meter';
      if (scene === habitat.preview.scene) return 'preview';
      if (scene === habitat.preview.bakeScene) return 'bake';
      return 'other';
    };
    habitat.renderer.render = (scene, camera) => {
      if (!queries || !ext) return original(scene, camera);
      const query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query); original(scene, camera); gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push({ tag: tagOf(scene), query });
    };
    async function collect(list) {
      const out = {};
      if (!ext) throw new Error('GPU profiling requires EXT_disjoint_timer_query_webgl2');
      if (!list.length) return out;
      while (!gl.getQueryParameter(list.at(-1).query, gl.QUERY_RESULT_AVAILABLE)) await timerTick();
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('GPU timer became disjoint; repeat this run');
      for (const { tag, query } of list) { out[tag] = (out[tag] ?? 0) + gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(query); }
      return out;
    }
    function configure({ set = {}, uniforms = {}, view = 'valley', weather = null } = {}) {
      Object.assign(settings, defaults, { paused: true }, set);
      habitat.apply({ ...settings });
      nav.setView(view);
      if (weather) habitat.setWeather(weather);
      Object.assign(habitat.material.uniforms.uLandUse, { value: true });
      Object.assign(habitat.material.uniforms.uSurfaceCache, { value: true });
      for (const [name, value] of Object.entries(uniforms)) habitat.material.uniforms[name].value = value;
      habitat.resetAccumulation();
    }
    async function run(label, options = {}) {
      const { warm = 3, count = 12, tick = timerTick } = options;
      configure(options);
      const guard = performance.now();
      while (habitat.samples < warm) {
        habitat.render(); await tick();
        if (performance.now() - guard > 90000) throw new Error(`warm-up timeout: ${label}`);
      }
      queries = [];
      let calls = 0, misses = 0;
      const startSamples = habitat.samples, cacheStart = habitat.cacheIteration, surfaceStart = habitat.surfaceSample, start = performance.now();
      while (habitat.samples < startSamples + count && performance.now() - start < 60000) {
        const samples = habitat.samples, band = habitat.band;
        calls++;
        habitat.render();
        if (habitat.samples === samples && habitat.band === band) misses++;
        await tick();
      }
      const wall = performance.now() - start, list = queries, done = habitat.samples - startSamples;
      queries = null;
      const gpu = await collect(list), total = Object.values(gpu).reduce((a, b) => a + b, 0), per = {};
      for (const [tag, ms] of Object.entries(gpu)) per[tag] = +(ms / done).toFixed(2);
      return { label, raySize: habitat.raySize, bands: habitat.bands, samplesPerSecond: +(done / (wall / 1000)).toFixed(2),
        wallMsPerSample: +(wall / done).toFixed(1), gpuMsPerSample: per, gpuBusy: +(total / wall).toFixed(3),
        renderCalls: calls, fenceMisses: misses, cacheIterations: habitat.cacheIteration - cacheStart, surfaceSamples: habitat.surfaceSample - surfaceStart };
    }

    if (mode === 'perf') {
      const results = [{ gpu: gpuName(gl), timerQueries: !!ext }];
      results.push(await run('clear valley, timer yield'));
      results.push(await run('clear valley, message-channel yield', { tick: channelTick }));
      // Time from the first traced band to the first displayed sample after a camera move.
      {
        configure();
        while (habitat.samples < 2) { habitat.render(); await timerTick(); }
        habitat.camera.position.x += 1e-4;
        queries = [];
        let pathStart = null;
        const begin = performance.now();
        while (!(habitat.mode === 'path' && habitat.samples >= 1) && performance.now() - begin < 30000) {
          habitat.render();
          if (habitat.mode === 'path' && pathStart === null) pathStart = performance.now();
          await timerTick();
        }
        const firstMs = performance.now() - pathStart, list = queries;
        queries = null;
        const gpu = await collect(list);
        for (const tag of Object.keys(gpu)) gpu[tag] = +gpu[tag].toFixed(1);
        results.push({ label: 'first sample after a camera move', previewHoldMs: +(pathStart - begin).toFixed(0), firstSampleMs: +firstMs.toFixed(0), gpuMs: gpu });
      }
      results.push(await run('clear ground', { view: 'ground' }));
      results.push(await run('clear overlook', { view: 'overlook' }));
      results.push(await run('clear axis', { view: 'axis' }));
      results.push(await run('valley, no trees or houses', { uniforms: { uLandUse: false } }));
      results.push(await run('ground, no trees or houses', { view: 'ground', uniforms: { uLandUse: false } }));
      results.push(await run('valley, no atmosphere', { set: { atmosphere: false } }));
      results.push(await run('valley, exact paths (surface cache off)', { uniforms: { uSurfaceCache: false } }));
      results.push(await run('valley, night (solar power 0)', { set: { solarPower: 0 } }));
      results.push(await run('valley, sun 59/-37 with pane routes', { set: { sunAzimuth: 59, sunElevation: -37 } }));
      const dry = new WeatherSolver({ ...defaults, clouds: true, humidity: 45 }).snapshot();
      results.push(await run('valley, clouds on but none present', { set: { clouds: true, humidity: 45 }, weather: { ...dry, revision: 11 }, count: 8 }));
      const solver = new WeatherSolver({ ...defaults, clouds: true, humidity: 78 });
      for (let i = 0; i < 200; i++) { solver.step(20); if (i % 20 === 0) await timerTick(); }
      const humid = solver.snapshot();
      results.push({ label: 'humid weather field', seconds: humid.stats.seconds, cloudFraction: humid.stats.cloudFraction });
      results.push(await run('valley, humid afternoon (paused)', { set: { clouds: true, humidity: 78 }, weather: { ...humid, revision: 12 }, warm: 2, count: 4 }));
      results.push(await run('ground, humid afternoon (paused)', { set: { clouds: true, humidity: 78 }, view: 'ground', warm: 2, count: 4 }));
      habitat.dispose();
      return results;
    }

    if (mode === 'extra') {
      const results = [];
      // Time from the first traced band to the first displayed sample after a camera move.
      configure();
      while (habitat.samples < 2) { habitat.render(); await timerTick(); }
      habitat.camera.position.x += 1e-4;
      {
        queries = [];
        let pathStart = null, moved = false;
        const begin = performance.now();
        while (performance.now() - begin < 30000) {
          habitat.render();
          moved ||= habitat.mode === 'preview';
          if (moved && habitat.mode === 'path' && pathStart === null) pathStart = performance.now();
          if (moved && habitat.mode === 'path' && habitat.samples >= 1) break;
          await timerTick();
        }
        const firstMs = performance.now() - pathStart, list = queries;
        queries = null;
        const gpu = await collect(list);
        for (const tag of Object.keys(gpu)) gpu[tag] = +gpu[tag].toFixed(1);
        results.push({ label: 'first sample after a camera move', previewHoldMs: +(pathStart - begin).toFixed(0), firstSampleMs: +firstMs.toFixed(0), gpuMs: gpu });
      }
      // Atlas rebakes, timed on the GPU (gl.finish does not wait in Chrome).
      for (const quality of ['balanced', 'fast']) {
        Object.assign(settings, defaults, { paused: true, quality });
        habitat.apply({ ...settings });
        const times = [];
        for (let i = 0; i < 2; i++) {
          habitat.preview.invalidate(true, true);
          queries = [];
          habitat.preview.prepare(habitat.renderer);
          const list = queries;
          queries = null;
          times.push(+((await collect(list)).bake ?? 0).toFixed(1));
        }
        results.push({ label: `terrain + anchors + cover + sun bake (${quality})`, atlas: `${habitat.preview.terrain.width}×${habitat.preview.terrain.height}`, gpuMs: times });
      }
      // Shader ablations: cold compile time of the tracer with one part stubbed out.
      const base = habitat.material.fragmentShader;
      const stub = (source, signature, body) => {
        if (!source.includes(signature)) throw new Error(`missing ${signature}`);
        return source.replace(signature, `${signature.replace(/\{$/, '')}{${body}}\n${signature.replace(/(\w+)\(/, '$1Unused(')}`);
      };
      const variants = {
        'no trees or houses (objectDistance stubbed)': stub(base, 'float objectDistance(vec3 p, float above, out float kind, out vec2 id) {', 'kind=0.0;id=vec2(0.0);return 1e3;'),
        'no diagnostic layer (diagnosticColor stubbed)': stub(base, 'vec3 diagnosticColor(vec3 ray) {', 'return vec3(0.0);'),
        'no pane-route search (paneRoutes stubbed)': stub(base, 'float paneRoutes(vec3 p,vec3 sun,bool draw,out PaneRoute route) {', 'route=PaneRoute(vec3(0.0),0.0,0.0,0.0,0);return 0.0;'),
        'terrain-only hit normals (objects left out of landNormal)': base.replace('if (kind > 0.5) d = min(d, objectDistance(p + e * k, above, objectKind, id));', '')
      };
      const r = habitat.renderer;
      for (const [label, source] of Object.entries(variants)) {
        if (source === base) throw new Error(`variant unchanged: ${label}`);
        habitat.material.fragmentShader = source; habitat.material.needsUpdate = true;
        r.setRenderTarget(habitat.targets[0]);
        const t = performance.now();
        r.compile(habitat.scene, habitat.screenCamera);
        gl.getProgramParameter(r.properties.get(habitat.material).currentProgram.program, gl.LINK_STATUS);
        const compileMs = +(performance.now() - t).toFixed(0);
        r.setRenderTarget(null);
        const row = { label: `tracer compile: ${label}`, compileMs };
        if (label.startsWith('terrain-only')) row.steady = await run('valley, terrain-only hit normals', { count: 8 });
        results.push(row);
      }
      habitat.material.fragmentShader = base; habitat.material.needsUpdate = true;
      habitat.dispose();
      return results;
    }

    // mode === 'correct'
    const out = { gpu: gpuName(gl) };
    const readAtlas = () => {
      const pixels = new Float32Array(128 * 192 * 4);
      habitat.renderer.readRenderTargetPixels(habitat.surfaceTargets[habitat.surfaceIndex], 0, 0, 128, 192, pixels);
      return pixels;
    };
    async function fill(samples) {
      const begin = performance.now();
      while (habitat.surfaceSample < samples && performance.now() - begin < 90000) { habitat.render(); await timerTick(); }
      return habitat.surfaceSample;
    }
    // 1. Endcap rim texels of the surface atlas.
    configure();
    out.rimSamples = await fill(128);
    {
      const atlas = readAtlas(), buckets = {};
      const add = (name, value) => { const b = buckets[name] ??= { count: 0, sum: 0 }; b.count++; b.sum += value; };
      for (let cap = 0; cap < 2; cap++) for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
        let inside = 0;
        for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) {
          const x = ((tx + (a + 0.5) / 8) / 64 - 0.5) * 2, y = ((ty + (b + 0.5) / 8) / 64 - 0.5) * 2;
          if (Math.hypot(x, y) < 1) inside++;
        }
        const coverage = inside / 64, rho = Math.hypot(((tx + 0.5) / 64 - 0.5) * 2, ((ty + 0.5) / 64 - 0.5) * 2);
        const value = atlas[((128 + ty) * 128 + cap * 64 + tx) * 4 + 1];
        const name = coverage === 0 ? 'outside' : coverage === 1 ? (rho > 0.85 ? 'inside, outer ring (0.85–1 R)' : rho > 0.6 ? 'inside, 0.6–0.85 R' : 'inside, core')
          : `rim, ${coverage <= 0.25 ? '0–25' : coverage <= 0.5 ? '25–50' : coverage <= 0.75 ? '50–75' : '75–100'}% in the disc`;
        add(`cap ${cap}: ${name}`, value);
      }
      out.endcapRim = Object.fromEntries(Object.entries(buckets).sort().map(([name, b]) => [name, { texels: b.count, meanGreenBand: +(b.sum / b.count).toExponential(3) }]));
    }
    // 2. Sunlight by routes no next-event estimate covers, at order 0 of atlas paths.
    const sun = { sunAzimuth: 59, sunElevation: -37 };
    out.paneSources = { mirrors: paneRouteSources({ ...defaults, ...sun }), sunOnly: paneRouteSources({ ...defaults, ...sun, lightMode: 'sun' }) };
    const wallStats = atlas => {
      const values = [];
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) values.push(atlas[(y * 128 + x) * 4 + 1]);
      const sorted = [...values].sort((a, b) => a - b), median = sorted[sorted.length >> 1];
      let sum = 0;
      for (const value of values) sum += value;
      return { values, median, mean: sum / values.length, max: sorted.at(-1), p999: sorted[Math.floor(sorted.length * 0.999)] };
    };
    configure({ set: sun });
    out.routeSamples = await fill(64);
    const before = wallStats(readAtlas());
    const patched = habitat.material.fragmentShader.replace('(sampled || s.order==0)', '(sampled || (s.order==0 && !excludeDirect))');
    out.patchApplied = patched !== habitat.material.fragmentShader;
    habitat.material.fragmentShader = patched; habitat.material.needsUpdate = true;
    configure({ set: sun });
    habitat.resetSurface();
    out.routeSamplesPatched = await fill(64);
    const after = wallStats(readAtlas());
    {
      let changed = 0, extra = 0;
      const jumps = [];
      for (let i = 0; i < before.values.length; i++) {
        const delta = before.values[i] - after.values[i];
        if (Math.abs(delta) > 1e-3 * Math.max(after.values[i], after.median)) { changed++; extra += delta; jumps.push(delta / after.median); }
      }
      jumps.sort((a, b) => b - a);
      const brief = s => ({ median: +s.median.toExponential(3), mean: +s.mean.toExponential(3), p999: +s.p999.toExponential(3), max: +s.max.toExponential(3) });
      out.unsampledRoutes = { texels: before.values.length, current: brief(before), omittedAtOrderZero: brief(after), texelsChanged: changed,
        meanShareOfAtlas: +(extra / before.values.length / before.mean).toFixed(4), largestJumpsInMedians: jumps.slice(0, 8).map(v => +v.toFixed(1)) };
    }
    habitat.dispose();
    return out;
  }, mode);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
