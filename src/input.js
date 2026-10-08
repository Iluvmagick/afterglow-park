// Keyboard + mouse -> per-tick commands. Presses are latched so a tap shorter than a
// physics tick still registers.

const BINDS = {
  KeyW: 'fwd',
  ArrowUp: 'fwd',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'crouch',
  ShiftRight: 'crouch',
  KeyC: 'crouch',
  KeyE: 'dash',
  KeyF: 'dash',
  KeyQ: 'grapple',
};
const LATCHED = ['jump', 'crouch', 'dash', 'grapple', 'fire'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.latch = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.sens = 2;
    this.locked = false;
    this.locking = false;
    this.enabled = false;
    this.onKey = null; // (code) => void, for non-movement keys
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const a = BINDS[e.code];
      if (a) {
        e.preventDefault();
        if (!this.held.has(a)) this.latch.add(a);
        this.held.add(a);
      } else if (this.onKey && !e.repeat) this.onKey(e.code, e);
    });
    addEventListener('keyup', (e) => {
      const a = BINDS[e.code];
      if (a) this.held.delete(a);
    });
    addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      const a = e.button === 0 ? 'fire' : e.button === 2 ? 'grapple' : e.button === 1 ? 'dash' : null;
      if (a) {
        this.held.add(a);
        this.latch.add(a);
      }
    });
    addEventListener('mouseup', (e) => {
      const a = e.button === 0 ? 'fire' : e.button === 2 ? 'grapple' : e.button === 1 ? 'dash' : null;
      if (a) this.held.delete(a);
    });
    addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled || !this.locked) return;
        e.preventDefault(); // when embedded in a page, don't scroll the page around the game
        if (e.deltaY !== 0) this.latch.add('jump'); // scroll-wheel bhop, for the purists
      },
      { passive: false },
    );
    addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      const k = this.sens * 0.0011;
      const dx = Math.max(-400, Math.min(400, e.movementX));
      const dy = Math.max(-400, Math.min(400, e.movementY));
      this.yaw -= dx * k;
      this.pitch -= dy * k;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.held.clear();
    });
  }

  // Raw (unaccelerated) mouse input where the browser supports it, plain pointer lock otherwise.
  // `locking` is set while a request is in flight, so a failed first attempt isn't taken for a refusal.
  // Resolves to false if the browser refused.
  async lock() {
    this.locking = true;
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
      return true;
    } catch {
      try {
        await this.canvas.requestPointerLock(); // Firefox, Safari: no unadjustedMovement
        return true;
      } catch {
        return false;
      }
    } finally {
      this.locking = false;
    }
  }

  cmd() {
    const h = this.held;
    const on = (a) => h.has(a) || (LATCHED.includes(a) && this.latch.has(a));
    return {
      forward: (h.has('fwd') ? 1 : 0) - (h.has('back') ? 1 : 0),
      right: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0),
      yaw: this.yaw,
      pitch: this.pitch,
      jump: on('jump'),
      crouch: on('crouch'),
      dash: on('dash'),
      grapple: on('grapple'),
      fire: on('fire'),
    };
  }

  consumeLatches() {
    this.latch.clear();
  }
}
