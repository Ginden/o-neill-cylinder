import type { Settings } from '../settings';
import {
  angularVelocity, backgroundAt, directIllumination, EARTH_GRAVITY,
  equilibrate, HEAT_CAPACITY, saturationMixingRatio, seededRandom
} from '../physics';

export interface WeatherStats {
  seconds: number;
  maxWind: number;
  cloudMass: number;
  cloudFraction: number;
  maxTemperatureAnomaly: number;
}

/** Coarse, incompressible moist convection in a rotating sealed volume.
 * Velocities are m/s; mixing ratios kg/kg; temperature anomalies K.
 * The prescribed hydrostatic background is not evolved by this Boussinesq model.
 */
export class WeatherSolver {
  readonly nx = 24;
  readonly ny = 24;
  readonly nz = 48;
  readonly count = this.nx * this.ny * this.nz;
  readonly active = new Uint8Array(this.count);
  readonly temperature = new Float32Array(this.count);
  readonly vapor = new Float32Array(this.count);
  readonly cloud = new Float32Array(this.count);
  readonly u = new Float32Array(this.count);
  readonly v = new Float32Array(this.count);
  readonly w = new Float32Array(this.count);
  readonly baseT = new Float32Array(this.count);
  readonly baseP = new Float32Array(this.count);
  readonly baseDensity = new Float32Array(this.count);
  private readonly baseVapor = new Float32Array(this.count);
  private readonly heat = new Float32Array(this.count);
  private readonly surface = new Float32Array(this.count);
  private readonly px = new Float32Array(this.count);
  private readonly py = new Float32Array(this.count);
  private readonly neighbors = new Int32Array(this.count * 6).fill(-1);
  private readonly scratch = Array.from({ length: 6 }, () => new Float32Array(this.count));
  private readonly divergence = new Float32Array(this.count);
  private pressure = new Float32Array(this.count);
  private pressureNext = new Float32Array(this.count);
  private readonly cells: number[] = [];
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  seconds = 0;

  constructor(readonly settings: Settings) {
    this.dx = settings.radius * 2000 / this.nx;
    this.dy = this.dx;
    this.dz = settings.length * 1000 / this.nz;
    const random = seededRandom(settings.seed);
    const wall = backgroundAt(settings.radius, settings);
    const mixedVapor = saturationMixingRatio(wall.temperature, wall.pressure) * settings.humidity / 100;
    for (let z = 0; z < this.nz; z++) {
      for (let y = 0; y < this.ny; y++) {
        for (let x = 0; x < this.nx; x++) {
          const i = this.index(x, y, z);
          const px = (x + 0.5) * this.dx - settings.radius * 1000;
          const py = (y + 0.5) * this.dy - settings.radius * 1000;
          const pz = (z + 0.5) * this.dz - settings.length * 500;
          const r = Math.hypot(px, py);
          if (r >= settings.radius * 1000) continue;
          this.active[i] = 1;
          this.cells.push(i);
          this.px[i] = px;
          this.py[i] = py;
          const b = backgroundAt(r / 1000, settings);
          this.baseT[i] = b.temperature;
          this.baseP[i] = b.pressure;
          this.baseDensity[i] = b.density;
          this.baseVapor[i] = saturationMixingRatio(b.temperature, b.pressure) * settings.humidity / 100;
          // Mixed water vapor can be supersaturated in cooler central air.
          this.vapor[i] = settings.pressure > 0 ? mixedVapor * (0.97 + random() * 0.06) : 0;
          this.temperature[i] = (random() - 0.5) * 0.3;
          const nearWall = Math.max(0, 1 - (settings.radius * 1000 - r) / (this.dx * 1.8));
          this.surface[i] = nearWall;
          this.heat[i] = nearWall * directIllumination([px / 1000, py / 1000, pz / 1000], settings)
            * (0.5 + 0.5 * Math.sin(pz / 1100 + Math.atan2(py, px) * 5) ** 2);
          this.w[i] = settings.wind * Math.sin(Math.PI * (z + 0.5) / this.nz) * (1 - nearWall);
        }
      }
    }
    const strides = [-1, 1, -this.nx, this.nx, -this.nx * this.ny, this.nx * this.ny];
    for (const i of this.cells) {
      const x = i % this.nx;
      const y = Math.floor(i / this.nx) % this.ny;
      const z = Math.floor(i / (this.nx * this.ny));
      const allowed = [x > 0, x < this.nx - 1, y > 0, y < this.ny - 1, z > 0, z < this.nz - 1];
      for (let j = 0; j < 6; j++) {
        const neighbor = i + strides[j];
        if (allowed[j] && this.active[neighbor]) this.neighbors[i * 6 + j] = neighbor;
      }
    }
    this.condense();
    this.project();
  }

  private index(x: number, y: number, z: number) {
    return x + this.nx * (y + this.ny * z);
  }

  private sample(field: Float32Array, x: number, y: number, z: number, fallback: number) {
    x = Math.max(0, Math.min(this.nx - 1.001, x));
    y = Math.max(0, Math.min(this.ny - 1.001, y));
    z = Math.max(0, Math.min(this.nz - 1.001, z));
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    let sum = 0, weights = 0;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let l = 0; l < 2; l++) {
      const i = this.index(ix + l, iy + j, iz + k);
      if (!this.active[i]) continue;
      const weight = (l ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
      sum += field[i] * weight;
      weights += weight;
    }
    return weights > 0 ? sum / weights : field[fallback];
  }

  private advect(dt: number) {
    const fields = [this.u, this.v, this.w, this.temperature, this.vapor, this.cloud];
    for (const i of this.cells) {
      const x = i % this.nx - this.u[i] * dt / this.dx;
      const y = Math.floor(i / this.nx) % this.ny - this.v[i] * dt / this.dy;
      const z = Math.floor(i / (this.nx * this.ny)) - this.w[i] * dt / this.dz;
      for (let f = 0; f < fields.length; f++) this.scratch[f][i] = this.sample(fields[f], x, y, z, i);
    }
    for (let f = 0; f < fields.length; f++) fields[f].set(this.scratch[f]);
  }

  private condense() {
    for (const i of this.cells) {
      const result = equilibrate(this.baseT[i] + this.temperature[i], this.vapor[i], this.cloud[i], this.baseP[i]);
      this.temperature[i] = result.temperature - this.baseT[i];
      this.vapor[i] = result.vapor;
      this.cloud[i] = result.cloud;
    }
  }

  private neighbor(field: Float32Array, i: number, direction: number, solidValue: number) {
    const j = this.neighbors[i * 6 + direction];
    return j < 0 ? solidValue : field[j];
  }

  divergenceRms() {
    let sum = 0;
    for (const i of this.cells) {
      const d = (this.neighbor(this.u, i, 1, 0) - this.neighbor(this.u, i, 0, 0)) / (2 * this.dx)
        + (this.neighbor(this.v, i, 3, 0) - this.neighbor(this.v, i, 2, 0)) / (2 * this.dy)
        + (this.neighbor(this.w, i, 5, 0) - this.neighbor(this.w, i, 4, 0)) / (2 * this.dz);
      this.divergence[i] = d;
      sum += d * d;
    }
    return Math.sqrt(sum / this.cells.length);
  }

  project() {
    this.enforceBoundary();
    this.divergenceRms();
    this.pressure.fill(0);
    const coefficients = [1 / this.dx ** 2, 1 / this.dx ** 2, 1 / this.dy ** 2,
      1 / this.dy ** 2, 1 / this.dz ** 2, 1 / this.dz ** 2];
    for (let iteration = 0; iteration < 24; iteration++) {
      for (const i of this.cells) {
        let sum = 0, weight = 0;
        for (let d = 0; d < 6; d++) {
          const j = this.neighbors[i * 6 + d];
          if (j < 0) continue;
          sum += this.pressure[j] * coefficients[d];
          weight += coefficients[d];
        }
        this.pressureNext[i] = (sum - this.divergence[i]) / weight;
      }
      [this.pressure, this.pressureNext] = [this.pressureNext, this.pressure];
    }
    for (const i of this.cells) {
      this.u[i] -= (this.neighbor(this.pressure, i, 1, this.pressure[i]) - this.neighbor(this.pressure, i, 0, this.pressure[i])) / (2 * this.dx);
      this.v[i] -= (this.neighbor(this.pressure, i, 3, this.pressure[i]) - this.neighbor(this.pressure, i, 2, this.pressure[i])) / (2 * this.dy);
      this.w[i] -= (this.neighbor(this.pressure, i, 5, this.pressure[i]) - this.neighbor(this.pressure, i, 4, this.pressure[i])) / (2 * this.dz);
    }
    this.enforceBoundary();
  }

  private enforceBoundary() {
    for (const i of this.cells) {
      if (this.neighbors[i * 6] < 0 || this.neighbors[i * 6 + 1] < 0
        || this.neighbors[i * 6 + 2] < 0 || this.neighbors[i * 6 + 3] < 0) {
        const r = Math.hypot(this.px[i], this.py[i]);
        const nx = this.px[i] / r, ny = this.py[i] / r;
        const outward = this.u[i] * nx + this.v[i] * ny;
        this.u[i] -= outward * nx;
        this.v[i] -= outward * ny;
      }
      if (this.neighbors[i * 6 + 4] < 0 || this.neighbors[i * 6 + 5] < 0) this.w[i] = 0;
    }
  }

  step(requestedDt: number) {
    let maxSpeed = 1;
    for (const i of this.cells) maxSpeed = Math.max(maxSpeed, Math.hypot(this.u[i], this.v[i], this.w[i]));
    const omega = angularVelocity(this.settings);
    const dt = Math.min(requestedDt, 0.5 * Math.min(this.dx, this.dy, this.dz) / maxSpeed, omega > 0 ? 0.3 / omega : Infinity, 20);
    this.advect(dt);
    const s = this.settings;
    // Integrate Coriolis exactly: no spurious kinetic energy from Euler stepping.
    const cos = Math.cos(2 * omega * dt), sin = Math.sin(2 * omega * dt);
    for (const i of this.cells) {
      const r = Math.hypot(this.px[i], this.py[i]);
      const nx = this.px[i] / Math.max(r, 1), ny = this.py[i] / Math.max(r, 1);
      const radialFraction = r / (s.radius * 1000);
      const inwardWind = -(this.u[i] * nx + this.v[i] * ny);
      const buoyancy = s.gravity * EARTH_GRAVITY * radialFraction
        * (this.temperature[i] / this.baseT[i] + 0.61 * (this.vapor[i] - this.baseVapor[i]) - this.cloud[i]);
      const u = this.u[i], v = this.v[i];
      const damping = Math.exp(-dt / 1200);
      this.u[i] = (cos * u + sin * v - nx * buoyancy * dt) * damping;
      this.v[i] = (cos * v - sin * u - ny * buoyancy * dt) * damping;
      this.w[i] *= damping;
      const dryLapse = s.gravity * EARTH_GRAVITY / HEAT_CAPACITY;
      this.temperature[i] += dt * (s.surfaceHeating * this.heat[i]
        - (dryLapse - s.lapseRate / 1000) * inwardWind * radialFraction);
      this.temperature[i] *= Math.exp(-dt / 2400);
      if (s.pressure > 0) {
        const deficit = Math.max(0, saturationMixingRatio(this.baseT[i] + this.temperature[i], this.baseP[i]) - this.vapor[i]);
        this.vapor[i] += Math.min(deficit, s.evaporation * this.surface[i] * dt);
      }
    }
    this.condense();
    this.project();
    this.seconds += dt;
    return dt;
  }

  snapshot() {
    const data = new Float32Array(this.count * 4);
    let mass = 0, cloudy = 0, maxWind = 0, maxTemperatureAnomaly = 0;
    for (const i of this.cells) {
      const t = this.baseT[i] + this.temperature[i];
      const density = this.baseP[i] / (287.05 * t);
      data[i * 4] = this.cloud[i] * density;
      data[i * 4 + 1] = this.temperature[i];
      data[i * 4 + 2] = this.vapor[i];
      data[i * 4 + 3] = density;
      mass += data[i * 4] * this.dx * this.dy * this.dz;
      if (data[i * 4] > 1e-5) cloudy++;
      maxWind = Math.max(maxWind, Math.hypot(this.u[i], this.v[i], this.w[i]));
      maxTemperatureAnomaly = Math.max(maxTemperatureAnomaly, Math.abs(this.temperature[i]));
    }
    const stats: WeatherStats = {
      seconds: this.seconds, maxWind, cloudMass: mass,
      cloudFraction: cloudy / this.cells.length, maxTemperatureAnomaly
    };
    return { data, stats, dimensions: [this.nx, this.ny, this.nz] as const };
  }
}
