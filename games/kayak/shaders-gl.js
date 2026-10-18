// GLSL ES 3.00 for the WebGL 2 fallback: the same three pipelines as the WGSL
// in shaders.js, line for line, so both look the same. Keep them in step.
// The Frame block has the same std140 layout as the WGSL struct, so one
// Float32Array feeds either. The projection maps depth to 0..1 (WebGPU's
// range); toGL() stretches it to WebGL's -1..1.

const FRAME = /* glsl */ `#version 300 es
precision highp float;
layout(std140) uniform Frame {
  mat4 viewProj;
  vec4 camPos;     // xyz, w = time in seconds
  vec4 camRight;   // xyz, w = tan(horizontal fov / 2)
  vec4 camUp;      // xyz, w = tan(vertical fov / 2)
  vec4 camFwd;
  vec4 sunDir;     // towards the sun
  vec4 skyTop;
  vec4 skyHorizon; // also the fog colour; w = fog density
  vec4 water;      // deep water colour
  vec4 boats[16];  // x, z, heading, speed: for their wakes
} frame;

vec4 toGL(vec4 clip) { return vec4(clip.xy, clip.z * 2.0 - clip.w, clip.w); }

vec3 fog(vec3 color, float dist) {
  float f = 1.0 - exp(-dist * frame.skyHorizon.w);
  return mix(color, frame.skyHorizon.rgb, clamp(f, 0.0, 1.0));
}

vec3 skyColor(vec3 dir, float halo) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(frame.skyHorizon.rgb, frame.skyTop.rgb, pow(h, 0.55));
  float sun = max(dot(dir, frame.sunDir.xyz), 0.0);
  c += vec3(1.0, 0.86, 0.62) * (pow(sun, 3000.0) * 8.0 + pow(sun, 48.0) * 0.2) * halo;
  return c;
}
`;

export const SKY = {
  vs: FRAME + /* glsl */ `
out vec2 ndc;
void main() {
  vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(p[gl_VertexID], 0.0, 1.0);
  ndc = p[gl_VertexID];
}
`,
  fs: FRAME + /* glsl */ `
in vec2 ndc;
out vec4 outColor;
void main() {
  vec3 dir = normalize(frame.camFwd.xyz
    + ndc.x * frame.camRight.xyz * frame.camRight.w
    + ndc.y * frame.camUp.xyz * frame.camUp.w);
  // Below the horizon the far-off river fades into the haze.
  vec3 below = mix(frame.skyHorizon.rgb, frame.water.rgb, 0.25);
  vec3 c = dir.y < 0.0 ? below : skyColor(dir, 1.0);
  outColor = vec4(c, 1.0);
}
`,
};

export const MESH = {
  vs: FRAME + /* glsl */ `
layout(location = 0) in vec3 pos;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec3 color;
layout(location = 3) in vec4 m0;
layout(location = 4) in vec4 m1;
layout(location = 5) in vec4 m2;
layout(location = 6) in vec4 m3;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
void main() {
  mat4 model = mat4(m0, m1, m2, m3);
  vec4 world = model * vec4(pos, 1.0);
  gl_Position = toGL(frame.viewProj * world);
  vWorld = world.xyz;
  vNormal = (model * vec4(normal, 0.0)).xyz;
  vColor = color;
}
`,
  fs: FRAME + /* glsl */ `
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float sun = max(dot(n, frame.sunDir.xyz), 0.0);
  vec3 ambient = mix(vec3(0.3, 0.27, 0.24), frame.skyTop.rgb * 0.7 + 0.25, 0.5 + 0.5 * n.y);
  vec3 lit = vColor * (vec3(1.0, 0.94, 0.82) * sun * 0.8 + ambient * 0.62);
  outColor = vec4(fog(lit, distance(vWorld, frame.camPos.xyz)), 1.0);
}
`,
};

const WAVES = /* glsl */ `
const float SPACING = 2.0;

// A few travelling sine waves: small, choppy, never repeating obviously.
float height(vec2 p, float t) {
  return 0.045 * sin(dot(p, vec2(0.21, 0.13)) + t * 1.3)
       + 0.035 * sin(dot(p, vec2(-0.17, 0.27)) + t * 1.7)
       + 0.02 * sin(dot(p, vec2(0.53, -0.41)) + t * 2.6)
       + 0.012 * sin(dot(p, vec2(-0.9, -0.7)) + t * 3.4);
}
`;

export const WATER = {
  vs: FRAME + WAVES + /* glsl */ `
layout(location = 0) in vec2 grid;
out vec3 vWorld;
void main() {
  vec2 snap = floor(frame.camPos.xz / SPACING) * SPACING;
  vec2 xz = grid + snap;
  vec3 world = vec3(xz.x, height(xz, frame.camPos.w), xz.y);
  gl_Position = toGL(frame.viewProj * vec4(world, 1.0));
  vWorld = world;
}
`,
  fs: FRAME + WAVES + /* glsl */ `
in vec3 vWorld;
out vec4 outColor;

// Fine ripples only exist in the normal, so they cost nothing in geometry.
vec2 ripple(vec2 p, float t) {
  vec2 a = cos(dot(p, vec2(1.9, 1.3)) + t * 4.1) * vec2(1.9, 1.3);
  vec2 b = cos(dot(p, vec2(-1.4, 2.3)) + t * 3.3) * vec2(-1.4, 2.3);
  vec2 c = cos(dot(p, vec2(3.7, -2.9)) + t * 5.7) * vec2(3.7, -2.9);
  return (a + b) * 0.03 + c * 0.014;
}

// Every boat's wake: see the WGSL in shaders.js.
vec2 wake(vec2 p) {
  vec2 o = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    vec4 b = frame.boats[i];
    if (b.w < 0.2) { continue; }
    vec2 d = p - b.xy;
    if (dot(d, d) > 2304.0) { continue; } // 48 m
    vec2 f = vec2(sin(b.z), -cos(b.z));
    float back = 3.3 - dot(d, f); // metres behind the bow
    if (back < -0.6 || back > 45.0) { continue; }
    float lat = abs(d.x * -f.y + d.y * f.x);
    if (lat > 1.8 + back * 0.48) { continue; }
    float strength = min(b.w / 4.0, 1.0);
    float arm = lat - 0.22 - back * 0.36;
    float width = 0.35 + back * 0.05;
    float env = exp(-arm * arm / (width * width)) * exp(-back / 16.0) * smoothstep(-0.6, 0.4, back);
    o.x += strength * 0.022 * env * cos(back * 2.8 - lat * 1.6);
    o.y += strength * env * exp(-back / 2.5) * 0.6;
    float behind = back - 5.2;
    if (behind > 0.0) {
      float trail = exp(-lat * lat / (0.15 + behind * 0.04)) * exp(-behind / 10.0);
      o.x += strength * 0.012 * trail * sin(behind * 3.7 + lat * 5.0);
      o.y += strength * trail * 0.25;
    }
  }
  return o;
}

void main() {
  float t = frame.camPos.w;
  vec2 p = vWorld.xz;
  vec3 toEye = frame.camPos.xyz - vWorld;
  float dist = length(toEye);
  // Slopes by forward differences. Far off, wakes are too small to see.
  float e = 0.05;
  float h = height(p, t);
  float dx = (height(p + vec2(e, 0.0), t) - h) / e;
  float dz = (height(p + vec2(0.0, e), t) - h) / e;
  vec2 w = vec2(0.0);
  if (dist < 140.0) {
    w = wake(p);
    dx += (wake(p + vec2(e, 0.0)).x - w.x) / e;
    dz += (wake(p + vec2(0.0, e)).x - w.x) / e;
  }
  vec2 r = ripple(p, t);
  vec3 n = normalize(vec3(-dx - r.x, 1.0, -dz - r.y));

  vec3 v = toEye / dist;
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = reflect(-v, n);
  vec3 sky = skyColor(vec3(refl.x, abs(refl.y), refl.z), 0.0);
  vec3 c = mix(frame.water.rgb, sky, clamp(fresnel * 1.15, 0.0, 1.0));
  // Sun glitter: a tight highlight that the ripples break up into sparkles.
  c += vec3(1.0, 0.9, 0.7) * pow(max(dot(refl, frame.sunDir.xyz), 0.0), 1200.0) * 2.0;
  float foam = clamp(w.y, 0.0, 1.0) * (0.6 + 0.4 * sin(dot(p, vec2(13.0, 9.0)) + t * 6.0));
  c = mix(c, vec3(0.85, 0.9, 0.9), foam * 0.45);
  outColor = vec4(fog(c, dist), 1.0);
}
`,
};
