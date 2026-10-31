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
  vec4 skyTop;     // w = cloud cover, 0..1
  vec4 skyHorizon; // also the fog colour; w = fog density
  vec4 water;      // deep water colour
  vec4 boats[16];  // x, z, heading, speed: for their wakes
  vec4 river;      // the river where you are: centre x, z and direction x, z
  vec4 banks;      // how far the trees stand left and right of it, how tall they are; w = 1 to draw them in the water
  vec4 spots[3];   // x, z, heading, how bright: the free places in the wash ahead of you
} frame;

vec4 toGL(vec4 clip) { return vec4(clip.xy, clip.z * 2.0 - clip.w, clip.w); }

vec3 fog(vec3 color, float dist) {
  float f = 1.0 - exp(-dist * frame.skyHorizon.w);
  return mix(color, frame.skyHorizon.rgb, clamp(f, 0.0, 1.0));
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Fair-weather cumulus on a layer overhead, drifting slowly downwind: how much
// cloud is in a direction (x), and how dense its core is there (y).
vec2 clouds(vec3 dir) {
  float cover = frame.skyTop.w;
  if (cover <= 0.0 || dir.y <= 0.0) { return vec2(0.0); }
  vec2 p = dir.xz / (dir.y + 0.08) * 1.2 + vec2(frame.camPos.w * 0.004, 0.0);
  float n = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    n += a * noise2(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  float t = 0.75 - 0.4 * cover;
  return vec2(smoothstep(t, t + 0.12, n) * smoothstep(0.0, 0.08, dir.y), smoothstep(t + 0.08, t + 0.4, n));
}

vec3 skyColor(vec3 dir, float halo) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(frame.skyHorizon.rgb, frame.skyTop.rgb, pow(h, 0.55));
  float sun = max(dot(dir, frame.sunDir.xyz), 0.0);
  vec2 cl = clouds(dir);
  // Bright edges, greyer where the cloud is thick.
  vec3 cloud = mix(vec3(0.96, 0.96, 0.95), vec3(0.64, 0.68, 0.74), cl.y) + vec3(1.0, 0.9, 0.75) * pow(sun, 8.0) * 0.25;
  c = mix(c, mix(cloud, frame.skyHorizon.rgb, 1.0 - smoothstep(0.0, 0.25, h)), cl.x);
  c += vec3(1.0, 0.86, 0.62) * (pow(sun, 3000.0) * 8.0 + pow(sun, 48.0) * 0.2) * halo * (1.0 - cl.x);
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

// The free places in the wash ahead of you: see the WGSL in shaders.js.
float spots(vec2 p) {
  float o = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 s = frame.spots[i];
    if (s.w <= 0.0) { continue; }
    vec2 f = vec2(sin(s.z), -cos(s.z));
    vec2 d = p - s.xy;
    float along = dot(d, f) - 0.7;
    float lat = d.x * -f.y + d.y * f.x;
    float e = length(vec2(along / 2.7, lat / 0.6));
    float ring = smoothstep(0.74, 0.88, e) * (1.0 - smoothstep(0.98, 1.12, e));
    float fill = 1.0 - smoothstep(0.85, 1.0, e);
    o = max(o, s.w * (ring + fill * 0.25));
  }
  return o;
}

// The riverside trees seen in the water. The reflected ray is followed across
// the river (taken as straight from where you are) to the line of trees on the
// bank it's heading for: if it meets them below their tops, it sees leaves.
// Rays heading up or down the river see the sky over the next reach.
const vec3 TREES = vec3(0.14, 0.2, 0.1);
float treeline(vec2 p, vec3 refl) {
  if (frame.banks.w < 0.5) return 0.0;
  vec2 along = frame.river.zw;
  vec2 across = vec2(-along.y, along.x);
  float l = clamp(dot(p - frame.river.xy, across), -frame.banks.x, frame.banks.y);
  float rl = dot(refl.xz, across);
  float bank = rl > 0.0 ? frame.banks.y : -frame.banks.x;
  float reach = min(abs(bank - l) / max(abs(rl), 0.0001), 900.0);
  float a = dot(p - frame.river.xy, along) + reach * dot(refl.xz, along);
  float top = frame.banks.z * (0.85 + 0.2 * sin(a * 0.13) + 0.12 * sin(a * 0.047 + 1.3));
  return 0.8 * (1.0 - smoothstep(top * 0.4, top * 1.6, reach * refl.y));
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
  vec3 sky = mix(skyColor(vec3(refl.x, abs(refl.y), refl.z), 0.0), TREES, treeline(p, refl));
  vec3 c = mix(frame.water.rgb, sky, clamp(fresnel * 1.15, 0.0, 1.0));
  // Sun glitter: a tight highlight that the ripples break up into sparkles.
  c += vec3(1.0, 0.9, 0.7) * pow(max(dot(refl, frame.sunDir.xyz), 0.0), 1200.0) * 2.0;
  float foam = clamp(w.y, 0.0, 1.0) * (0.6 + 0.4 * sin(dot(p, vec2(13.0, 9.0)) + t * 6.0));
  c = mix(c, vec3(0.85, 0.9, 0.9), foam * 0.45);
  c = mix(c, vec3(0.85, 0.97, 1.0), clamp(spots(p), 0.0, 1.0) * 0.7);
  outColor = vec4(fog(c, dist), 1.0);
}
`,
};
