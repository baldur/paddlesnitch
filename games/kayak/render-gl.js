// WebGL 2 fallback for browsers without WebGPU (older iPhones, Firefox and
// some Android phones): the same scene as render.js and the same interface,
// so main.js doesn't care which it gets. Like the WebGPU renderer it draws
// into a 4x multisampled target with a 24-bit depth buffer and resolves that
// to the screen. Phones expose no GPU timer, so the resolution follows frame
// times instead (pacing.js).
import { SKY, MESH, WATER } from './shaders-gl.js';
import { waterGrid } from './meshes.js';
import { createPacer } from './pacing.js';

const FRAME_BYTES = 16 * 4 + 24 * 16;
const MAX_DPR = matchMedia('(pointer: coarse)').matches ? 1.5 : 2;

export function createRendererGL(canvas) {
  // alpha: the multisample resolve below needs the canvas to be RGBA, like
  // the target. Every pixel is drawn with alpha 1, so it still looks opaque.
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error("WebGL 2 isn't available in this browser.");
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
  // Phones drop WebGL contexts under memory pressure, often after the app was
  // in the background. Every buffer goes with it, so when it's back, start over.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  const program = ({ vs, fs }) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Shader error: ${gl.getProgramInfoLog(p)}`);
    gl.uniformBlockBinding(p, gl.getUniformBlockIndex(p, 'Frame'), 0);
    return p;
  };
  const sky = program(SKY);
  const water = program(WATER);
  const mesh = program(MESH);

  const frameBuffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
  gl.bufferData(gl.UNIFORM_BUFFER, FRAME_BYTES, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, frameBuffer);

  const skyVao = gl.createVertexArray();

  const grid = waterGrid(260, 520);
  const gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);
  const gridCount = grid.length / 2;

  // The multisampled target, rebuilt when the size changes.
  const target = gl.createFramebuffer();
  const color = gl.createRenderbuffer();
  const depth = gl.createRenderbuffer();
  let width = 0;
  let height = 0;

  const pacer = createPacer();
  let lastDraw = null;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR) * pacer.scale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === width && h === height) return;
    width = canvas.width = w;
    height = canvas.height = h;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }

  return {
    backend: 'webgl2',

    // A mesh from meshes.js, drawn with up to `maxInstances` model matrices.
    createMesh({ vertices, count }, maxInstances = 1) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12);
      }
      const instances = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferData(gl.ARRAY_BUFFER, 64 * maxInstances, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(3 + i);
        gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, 64, i * 16);
        gl.vertexAttribDivisor(3 + i, 1);
      }
      gl.bindVertexArray(null);
      return { vao, count, instances, scratch: new Float32Array(16 * maxInstances), instanceCount: 0 };
    },

    // Sets a mesh's model matrices for the next frames (an array of Float32Array(16)).
    place(m, matrices) {
      matrices.forEach((mat, i) => m.scratch.set(mat, i * 16));
      gl.bindBuffer(gl.ARRAY_BUFFER, m.instances);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.scratch, 0, matrices.length * 16);
      m.instanceCount = matrices.length;
    },

    // frameData: Float32Array laid out like the Frame block.
    draw(frameData, meshes) {
      const now = performance.now();
      if (lastDraw !== null) pacer.tick(now - lastDraw);
      lastDraw = now;
      resize();
      gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, frameData);

      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(false);
      gl.useProgram(sky);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.useProgram(mesh);
      for (const m of meshes) {
        if (!m.instanceCount) continue;
        gl.bindVertexArray(m.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.instanceCount);
      }
      gl.useProgram(water);
      gl.bindVertexArray(gridVao);
      gl.drawArrays(gl.TRIANGLES, 0, gridCount);
      gl.bindVertexArray(null);

      // Resolve the multisampled picture onto the canvas.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    // For the debug hook: how the adaptive resolution is doing.
    get stats() {
      return { backend: 'webgl2', scale: pacer.scale, frameMs: pacer.frameMs, width: canvas.width, height: canvas.height };
    },

    get aspect() {
      return canvas.clientWidth / Math.max(1, canvas.clientHeight);
    },
  };
}
