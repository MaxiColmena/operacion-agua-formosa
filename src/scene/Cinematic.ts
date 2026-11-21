// Smooth, time-based camera paths for the guided tour and the cinematic presentation.
import * as THREE from 'three';
import type { MapScene } from './MapScene';

export interface CamKey {
  /** Seconds from the start of the path. */
  t: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Centripetal Catmull-Rom through camera keys. Keys may be unevenly spaced in time: time is mapped
 * piecewise onto the curve parameter, so motion stays continuous and never jumps between keys.
 */
export class CameraPath {
  readonly duration: number;
  private pos: THREE.CatmullRomCurve3;
  private tgt: THREE.CatmullRomCurve3;
  private times: number[];

  constructor(keys: CamKey[]) {
    if (keys.length < 2) throw new Error('CameraPath needs at least two keys');
    this.times = keys.map((k) => k.t);
    this.duration = this.times[this.times.length - 1];
    this.pos = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
    this.tgt = new THREE.CatmullRomCurve3(keys.map((k) => k.target), false, 'centripetal');
  }

  /** Writes the camera position and look-at target for time t (seconds), eased at both ends. */
  sample(t: number, outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const tt = Math.max(0, Math.min(this.duration, t));
    const n = this.times.length - 1;
    let i = 0;
    while (i < n - 1 && tt > this.times[i + 1]) i++;
    const span = Math.max(1e-6, this.times[i + 1] - this.times[i]);
    let f = (tt - this.times[i]) / span;
    // Ease in on the first segment and out on the last; both meet the cruise speed (slope 1) of the
    // inner segments, so the camera starts and stops gently without a speed kink.
    if (n === 1) f = smooth(f);
    else if (i === 0) f = f * f * (2 - f);
    else if (i === n - 1) f = 1 - (1 - f) * (1 - f) * (1 + f);
    const u = (i + Math.max(0, Math.min(1, f))) / n;
    this.pos.getPoint(u, outPos);
    this.tgt.getPoint(u, outTarget);
  }
}

/** Keys orbiting a world-space center: radius and height in km, angles in radians. */
export function orbitKeys(center: THREE.Vector3, radius: number, height: number, a0: number, a1: number, t0: number, t1: number, steps = 6): CamKey[] {
  const out: CamKey[] = [];
  for (let s = 0; s <= steps; s++) {
    const f = s / steps, a = a0 + (a1 - a0) * f;
    out.push({
      t: t0 + (t1 - t0) * f,
      pos: new THREE.Vector3(center.x + Math.cos(a) * radius, center.y + height, center.z + Math.sin(a) * radius),
      target: center.clone(),
    });
  }
  return out;
}

/** Plays a CameraPath on a MapScene through its camera-driver hook. */
export class PathPlayer {
  private t = 0;
  private playing = true;
  private tmpP = new THREE.Vector3();
  private tmpT = new THREE.Vector3();

  constructor(private scene: MapScene, private path: CameraPath, private onEnd?: () => void) {
    scene.setCameraDriver((dt) => this.step(dt));
  }

  get time() { return this.t; }
  set paused(v: boolean) { this.playing = !v; }
  get paused() { return !this.playing; }

  seek(t: number) { this.t = Math.max(0, Math.min(this.path.duration, t)); }

  private step(dt: number) {
    if (this.playing) this.t += dt;
    this.path.sample(this.t, this.tmpP, this.tmpT);
    this.scene.camera.position.copy(this.tmpP);
    this.scene.controls.target.copy(this.tmpT);
    if (this.t >= this.path.duration && this.onEnd) {
      const cb = this.onEnd;
      this.onEnd = undefined;
      cb();
    }
  }

  stop() { this.scene.setCameraDriver(null); }
}

/** Landmarks of Formosa Capital used to frame shots (lon, lat). */
export const LANDMARKS = {
  center: [-58.1755, -26.1845] as const, // Plaza San Martín
  hospitalCentral: [-58.1685, -26.1886] as const,
  port: [-58.161, -26.1905] as const, // breach point of the defense ring
  north: [-58.168, -26.150] as const,
  south: [-58.185, -26.222] as const,
  west: [-58.225, -26.192] as const,
};
