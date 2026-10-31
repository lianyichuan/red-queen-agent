// 红色粒子核心：毛玻璃质感（普通混合，浅色/深色壁纸上都不曝白）
// 待机半透明、悬停/工作时变不透明——由 hologram.js 驱动 uOpacity
import * as THREE from 'three';

export function createOrb(scene) {
  const N = 14000;
  const positions = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = 1 + (Math.random() - 0.5) * 0.06;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = s * Math.cos(theta) * r;
    positions[i * 3 + 1] = u * r;
    positions[i * 3 + 2] = s * Math.sin(theta) * r;
    seeds[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uState: { value: 0 },
    uLevel: { value: 0 },
    uOpacity: { value: 0.6 },
    uColorA: { value: new THREE.Color('#4a0a14') }, // 深红核
    uColorB: { value: new THREE.Color('#ff9a9a') }, // 亮红边
  };

  // 粒子：普通混合，深色为主、边缘发亮
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uState, uLevel;
      varying float vI;
      void main() {
        vec3 p = normalize(position);
        float t = uTime, seed = aSeed;
        float breathe = 0.025 * sin(t * 0.9 + seed * 6.2831);
        float conv = uState == 1.0 ? (0.72 + 0.06 * sin(t * 3.0)) : 1.0;
        float turb = uState == 2.0 ? 0.22 : 0.06;
        vec3 chaos = vec3(
          sin(t * 2.3 + seed * 17.0),
          cos(t * 1.9 + seed * 23.0),
          sin(t * 2.7 + seed * 11.0));
        float pop = uLevel * (0.10 + 0.12 * sin(seed * 40.0 + t * 12.0));
        float r = conv + breathe + pop + turb * 0.18 * sin(seed * 31.0 + t * 4.0);
        vec3 pos = p * r + chaos * turb * 0.25;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float spark = uState == 2.0 ? 0.5 * fract(sin(t * 8.0 + seed * 99.0) * 43758.5) : 0.0;
        float size = (1.5 + 2.1 * seed) * (1.0 + uLevel * 1.5 + spark);
        gl_PointSize = clamp(size * (7.5 / -mv.z), 1.0, 9.0);
        vI = 0.35 + 0.65 * seed + uLevel * 0.5;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vI;
      uniform vec3 uColorA, uColorB;
      uniform float uOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d);
        vec3 col = mix(uColorA, uColorB, clamp(vI, 0.0, 1.0));
        gl_FragColor = vec4(col, a * (0.30 + 0.70 * vI) * uOpacity);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);

  // 玻璃壳：给球一个实体感的暗红底，壁纸上不曝白
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.97, 48, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#5c0e1a'),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );

  const group = new THREE.Group();
  group.add(shell);
  group.add(points);
  scene.add(group);

  return { group, points, shell, uniforms };
}
