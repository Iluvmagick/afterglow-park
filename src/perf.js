// Lightweight performance metrics: rolling CPU timings per phase, frame intervals, and GPU time
// via EXT_disjoint_timer_query_webgl2 when the browser exposes it.

const N = 240;

class Series {
  constructor() {
    this.buf = new Float32Array(N);
    this.n = 0;
    this.i = 0;
  }
  add(v) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % N;
    this.n = Math.min(N, this.n + 1);
  }
  stats() {
    if (!this.n) return { avg: 0, p95: 0, max: 0 };
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    const avg = a.reduce((s, v) => s + v, 0) / a.length;
    return { avg, p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))], max: a[a.length - 1] };
  }
}

export class Perf {
  constructor(gl) {
    this.gl = gl;
    this.series = {};
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.active = null;
  }

  add(name, ms) {
    (this.series[name] ||= new Series()).add(ms);
  }

  stats(name) {
    return this.series[name] ? this.series[name].stats() : null;
  }

  // GPU timing brackets (no-ops when the extension is unavailable)
  gpuBegin() {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  gpuEnd() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll() {
    const gl = this.gl;
    if (!this.ext) return;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) this.add('gpu', ns / 1e6);
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }

  lines(info) {
    const f = (name) => {
      const s = this.stats(name);
      return s ? `${s.avg.toFixed(2)}` : '-';
    };
    const frame = this.stats('frame');
    const fps = frame && frame.avg > 0 ? 1000 / frame.avg : 0;
    const gpu = this.ext ? `${f('gpu')} MS` : 'N/A';
    return [
      `FPS ${fps.toFixed(0)}  FRAME ${frame ? frame.avg.toFixed(1) : '-'} P95 ${frame ? frame.p95.toFixed(1) : '-'}`,
      `CPU SIM ${f('sim')} REND ${f('render')} HUD ${f('hud')}`,
      `GPU ${gpu}  TRIS ${Math.round(info.triangles / 1000)}K  CALLS ${info.calls}`,
    ];
  }
}
