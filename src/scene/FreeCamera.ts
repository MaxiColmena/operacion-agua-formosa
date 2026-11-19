import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Cámara libre estilo dron: WASD/flechas mueven en el plano horizontal según el rumbo de la vista,
 * Q/E (o Ctrl/Espacio) bajan/suben, Shift acelera, arrastrar con el mouse (botón izq. o der.) mira
 * alrededor y la rueda cambia la velocidad. La velocidad escala con la altura sobre el terreno.
 *
 * Mientras está activa mantiene `controls.target` en un punto delante de la cámara, así al salir
 * OrbitControls retoma sin salto (y focusFacility sigue calculando un encuadre razonable).
 */
export interface FreeCameraEnv {
  /** Altura del suelo (mundo, km) en x/z de mundo, con la exageración actual. */
  groundY(x: number, z: number): number;
  /** Medio ancho / medio alto del mapa (km). */
  halfW: number;
  halfH: number;
}

export interface FreeCameraState {
  active: boolean;
  /** Multiplicador de velocidad elegido con la rueda. */
  speed: number;
}

const CLEARANCE = 0.015; // 15 m sobre el terreno (en km de mundo)
const MARGIN = 1.5; // km fuera del mapa permitidos
const MAX_Y = 25;
const LOOK_SENS = 0.0035; // rad por píxel
const MAX_PITCH = Math.PI / 2 - 0.02;
const ACCEL = 7; // 1/s: respuesta de la velocidad (amortiguación exponencial)
const SPEED_MIN = 0.25, SPEED_MAX = 6;

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1],
  KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyE: [0, 1, 0], Space: [0, 1, 0], PageUp: [0, 1, 0],
  KeyQ: [0, -1, 0], ControlLeft: [0, -1, 0], ControlRight: [0, -1, 0], PageDown: [0, -1, 0],
};

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Sliders/checkbox no capturan texto: F y Esc siguen funcionando.
    return !['range', 'checkbox', 'radio', 'button'].includes(type);
  }
  return false;
}

export class FreeCamera {
  active = false;
  speed = 1;
  onChange: ((s: FreeCameraState) => void) | null = null;

  private keys = new Set<string>();
  private fresh = new Set<string>();
  private pendingUp = new Set<string>();
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private suppressClick = false;
  private defaults: { maxPolar: number; minDist: number };
  private relaxed = false;
  private near = 0.01;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private dom: HTMLElement,
    private env: FreeCameraEnv,
  ) {
    this.defaults = { maxPolar: controls.maxPolarAngle, minDist: controls.minDistance };    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
    // Fase de captura: se ejecuta antes que el click de selección de App y lo anula tras un arrastre.
    dom.addEventListener('click', this.onClick, true);
  }

  set(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.keys.clear();
    this.fresh.clear();
    this.pendingUp.clear();
    this.vel.set(0, 0, 0);
    this.drag = null;
    if (on) {
      this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = this.euler.y;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.euler.x));
      this.controls.enabled = false;
      this.dom.style.cursor = 'grab';
      // A ras del suelo el plano cercano de 10 m recortaría los edificios vecinos.
      this.near = this.camera.near;
      this.camera.near = Math.min(this.near, 0.002);
      this.camera.updateProjectionMatrix();
    } else {
      this.syncTarget(true);
      this.controls.enabled = true;
      this.controls.update();
      this.dom.style.cursor = '';
      this.camera.near = this.near;
      this.camera.updateProjectionMatrix();
    }
    this.emit();
  }

  private emit() {
    this.onChange?.({ active: this.active, speed: this.speed });
  }

  /** Llamar en cada cuadro, antes de controls.update(). */
  update(dt: number) {
    if (!this.active) {
      // Restaura los límites de OrbitControls que se relajaron al salir, cuando ya se cumplen.
      if (this.relaxed) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const polar = Math.acos(Math.max(-1, Math.min(1, off.y / (off.length() || 1))));
        if (polar <= this.defaults.maxPolar) this.controls.maxPolarAngle = this.defaults.maxPolar;
        if (off.length() >= this.defaults.minDist) this.controls.minDistance = this.defaults.minDist;
        if (this.controls.maxPolarAngle === this.defaults.maxPolar && this.controls.minDistance === this.defaults.minDist) this.relaxed = false;
      }
      return;
    }
    const cam = this.camera;
    const p = cam.position;
    const ground = this.env.groundY(p.x, p.z);
    const h = Math.max(0, p.y - ground);

    // Velocidad base (km/s): ~15 m/s a ras del suelo, proporcional a la altura más arriba.
    let base = Math.max(0.015, h * 0.8) * this.speed;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) base *= 4;

    const input = new THREE.Vector3();
    for (const k of this.keys) {
      const m = MOVE_KEYS[k];
      if (m) input.x += m[0], input.y += m[1], input.z += m[2];
    }
    for (const k of this.pendingUp) this.keys.delete(k);
    this.pendingUp.clear();
    this.fresh.clear();
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Adelante (-Z de la cámara) proyectado al plano horizontal; derecha perpendicular.
    const want = new THREE.Vector3(
      (-sin * input.z + cos * input.x),
      0,
      (-cos * input.z - sin * input.x),
    );
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(base);
    want.y = Math.sign(input.y) * base * 0.7;

    const k = 1 - Math.exp(-ACCEL * dt);
    this.vel.lerp(want, k);
    p.addScaledVector(this.vel, dt);

    // Límites: dentro del mapa (margen mayor cuanto más alto) y por encima del relieve/agua.
    // Si se está afuera (p. ej. al entrar desde una vista lejana) se vuelve suave, sin salto.
    const margin = Math.min(MARGIN, 0.15 + h * 0.4);
    // Solo mientras el usuario se mueve: al entrar la cámara queda quieta donde estaba.
    const pull = input.lengthSq() > 0 ? 1 - Math.exp(-3 * dt) : 0;
    const lx = this.env.halfW + margin, lz = this.env.halfH + margin;
    const cx = Math.max(-lx, Math.min(lx, p.x)), cz = Math.max(-lz, Math.min(lz, p.z));
    p.x += (cx - p.x) * (Math.abs(p.x) > lx + 0.05 ? pull : 1);
    p.z += (cz - p.z) * (Math.abs(p.z) > lz + 0.05 ? pull : 1);
    const floor = this.env.groundY(p.x, p.z) + CLEARANCE;
    if (p.y < floor) { p.y = floor; if (this.vel.y < 0) this.vel.y = 0; }
    if (p.y > MAX_Y) { p.y += (MAX_Y - p.y) * pull; if (this.vel.y > 0) this.vel.y = 0; }

    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(this.euler);
    this.syncTarget(false);
  }

  /**
   * Pone controls.target sobre el rayo de la vista (donde corta el suelo, o a cierta distancia),
   * de modo que OrbitControls no cambie el encuadre al retomarlo. Si el encuadre viola sus límites
   * (polar máx., distancia mín.) los relaja hasta que el usuario vuelva a estar dentro.
   */
  private syncTarget(exiting: boolean) {
    const cam = this.camera;
    const p = cam.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const h = Math.max(0.01, p.y - this.env.groundY(p.x, p.z));
    let dist = Math.min(4, Math.max(0.65, h * 4));
    if (dir.y < -0.02) {
      // Marcha sobre el rayo hasta cortar el relieve.
      const step = 0.05;
      for (let s = step; s < 12; s += step) {
        const x = p.x + dir.x * s, y = p.y + dir.y * s, z = p.z + dir.z * s;
        if (y <= this.env.groundY(x, z)) { dist = s; break; }
      }
      dist = Math.max(0.65, Math.min(8, dist));
    }
    this.controls.target.copy(p).addScaledVector(dir, dist);
    if (exiting) {
      const off = p.clone().sub(this.controls.target);
      const polar = Math.acos(Math.max(-1, Math.min(1, off.y / off.length())));
      if (polar > this.defaults.maxPolar) { this.controls.maxPolarAngle = Math.min(Math.PI, polar + 1e-3); this.relaxed = true; }
      if (off.length() < this.defaults.minDist) { this.controls.minDistance = off.length() * 0.99; this.relaxed = true; }
    }
  }

  // ---------- eventos ----------
  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.altKey || e.metaKey) return;
    if (e.code === 'KeyF' && !e.ctrlKey && !e.repeat) { e.preventDefault(); this.set(!this.active); return; }
    if (!this.active) return;
    if (e.code === 'Escape') { e.preventDefault(); this.set(false); return; }
    if (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') return; // atajos del navegador
    if (MOVE_KEYS[e.code] || e.code.startsWith('Shift')) {
      e.preventDefault();
      // Evita que Espacio/flechas activen el botón enfocado o desplacen la página.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !isTyping(document.activeElement)) {
        document.activeElement.blur();
      }
      this.keys.add(e.code);
      this.fresh.add(e.code);
      this.pendingUp.delete(e.code);
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    // Un toque más corto que un cuadro igual cuenta: se suelta después del próximo update().
    if (this.fresh.has(e.code)) this.pendingUp.add(e.code);
    else this.keys.delete(e.code);
  };
  private onBlur = () => { this.keys.clear(); this.drag = null; };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.active || (e.button !== 0 && e.button !== 2)) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    this.suppressClick = false;
    this.dom.style.cursor = 'grabbing';
    e.preventDefault();
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.active || !this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this.drag.moved > 4) this.suppressClick = true;
    this.yaw -= dx * LOOK_SENS;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * LOOK_SENS));
  };
  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    if (this.active) this.dom.style.cursor = 'grab';
  };
  private onClick = (e: MouseEvent) => {
    if (this.active && this.suppressClick) { e.stopImmediatePropagation(); this.suppressClick = false; }
  };
  private onContextMenu = (e: MouseEvent) => { if (this.active) e.preventDefault(); };
  /** La rueda ajusta la velocidad (no avanza): W ya avanza y así no se pierde el control fino. */
  private onWheel = (e: WheelEvent) => {
    if (!this.active) return;
    e.preventDefault();
    const f = Math.pow(1.15, -Math.sign(e.deltaY));
    this.speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(this.speed * f * 100) / 100));
    this.emit();
  };

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    this.dom.removeEventListener('click', this.onClick, true);
  }
}
