import * as THREE from 'three';
import type { Settings } from '../settings';
import { surfaceHeight, terrainAtlasSize } from '../terrain';

// Eye height of a standing person, km.
const EYE_HEIGHT = 0.0017;

/** Free flight with local up toward the rotation axis. Distances are km. In the
 * ground view the observer walks: the eye keeps its height above the drawn
 * surface, and Q/E change that height. */
export class Navigation {
  private yaw = 0;
  private pitch = 0.1;
  private drag = false;
  private view: Settings['view'] = 'valley';
  private altitude = EYE_HEIGHT;
  private readonly keys = new Set<string>();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly level = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  moved = false;
  get interacting() {return this.drag || this.keys.size>0;}
  private get walking() {return this.view === 'ground';}

  constructor(private readonly camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, private readonly settings: Settings) {
    canvas.addEventListener('pointerdown', e => {
      this.drag = true;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
    });
    canvas.addEventListener('pointerup', () => { this.drag = false; });
    canvas.addEventListener('pointercancel', () => { this.drag = false; });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.yaw += e.movementX * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.003, -1.45, 1.45);
      this.moved = true;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.walking) {
        this.camera.position.addScaledVector(this.level, -e.deltaY * Math.max(this.altitude, 0.002) * 0.05);
        this.stand();
      } else {
        this.camera.getWorldDirection(this.forward);
        this.camera.position.addScaledVector(this.forward, -e.deltaY * settings.radius * 0.0002);
        this.clamp();
      }
      this.moved = true;
    }, { passive: false });
    canvas.addEventListener('keydown', e => {
      if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft'].includes(e.code)) {
        e.preventDefault(); this.keys.add(e.code);
      }
    });
    canvas.addEventListener('keyup', e => this.keys.delete(e.code));
    canvas.addEventListener('blur', () => { this.keys.clear(); this.drag = false; });
    this.setView(settings.view);
  }

  setView(view: Settings['view']) {
    this.view = view;
    this.yaw = 0;
    this.pitch = view === 'axis' ? 0 : view === 'overlook' ? 0.08 : view === 'ground' ? 0.05 : 0.15;
    const radius = this.settings.radius;
    if (view === 'axis') this.camera.position.set(0, -radius * 0.015, -this.settings.length * 0.32);
    else if (view === 'ground') {
      // Below the valley view, on the floodplain beside the river.
      this.altitude = EYE_HEIGHT;
      this.camera.position.set(radius * 0.05, -radius, -this.settings.length * 0.35);
      this.stand();
    } else this.camera.position.set(radius * 0.05,
      -radius + Math.max(this.settings.terrainHeight * 1.1 + 0.05, radius * (view === 'overlook' ? 0.3 : 0.045)),
      -this.settings.length * 0.35);
    this.moved = false;
    this.update(0);
  }

  private clamp() {
    const p = this.camera.position;
    const maximumRadius = this.settings.radius - this.settings.terrainHeight * 1.9 - 0.04;
    const r = Math.hypot(p.x, p.y);
    if (r > maximumRadius) { p.x *= maximumRadius / r; p.y *= maximumRadius / r; }
    p.z = THREE.MathUtils.clamp(p.z, -this.settings.length / 2 + 0.03, this.settings.length / 2 - 0.03);
  }

  /** Keeps the eye `altitude` above the land, or above a pane in the windows. */
  private stand() {
    const p = this.camera.position, s = this.settings;
    p.z = THREE.MathUtils.clamp(p.z, -s.length / 2 + 0.03, s.length / 2 - 0.03);
    const theta = Math.atan2(p.y, p.x);
    const radius = s.radius - surfaceHeight(theta, p.z, s, terrainAtlasSize(s)) - this.altitude;
    p.set(Math.cos(theta) * radius, Math.sin(theta) * radius, p.z);
  }

  update(dt: number) {
    const p = this.camera.position;
    const radial = Math.hypot(p.x, p.y);
    this.up.set(-p.x, -p.y, 0).normalize();
    if (radial < 0.0001) this.up.set(0, 1, 0);
    this.right.crossVectors(new THREE.Vector3(0,0,1), this.up).normalize();
    this.level.set(0,0,1).multiplyScalar(Math.cos(this.yaw)).addScaledVector(this.right, Math.sin(this.yaw));
    this.forward.copy(this.level).multiplyScalar(Math.cos(this.pitch)).addScaledVector(this.up, Math.sin(this.pitch));
    const fast = this.keys.has('ShiftLeft') ? 4 : 1;
    if (this.walking) {
      // A brisk walk at eye height, faster higher up.
      const speed = Math.min(this.settings.radius * 0.12, Math.max(0.005, this.altitude * 3)) * dt * fast;
      if (this.keys.has('KeyW')) p.addScaledVector(this.level, speed);
      if (this.keys.has('KeyS')) p.addScaledVector(this.level, -speed);
      if (this.keys.has('KeyA')) p.addScaledVector(this.right, speed);
      if (this.keys.has('KeyD')) p.addScaledVector(this.right, -speed);
      if (this.keys.has('KeyE')) this.altitude += speed;
      if (this.keys.has('KeyQ')) this.altitude = Math.max(EYE_HEIGHT, this.altitude - speed);
      this.stand();
    } else {
      const speed = this.settings.radius * 0.12 * dt * fast;
      if (this.keys.has('KeyW')) p.addScaledVector(this.forward, speed);
      if (this.keys.has('KeyS')) p.addScaledVector(this.forward, -speed);
      if (this.keys.has('KeyA')) p.addScaledVector(this.right, speed);
      if (this.keys.has('KeyD')) p.addScaledVector(this.right, -speed);
      if (this.keys.has('KeyE')) p.addScaledVector(this.up, speed);
      if (this.keys.has('KeyQ')) p.addScaledVector(this.up, -speed);
      this.clamp();
    }
    if (this.keys.has('ArrowLeft')) this.yaw -= dt;
    if (this.keys.has('ArrowRight')) this.yaw += dt;
    if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.45,this.pitch+dt);
    if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.45,this.pitch-dt);
    if (this.keys.size) this.moved = true;
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.target.copy(p).add(this.forward));
  }
}
