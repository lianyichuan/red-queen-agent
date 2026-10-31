// 奥尔特云粒子：环绕红后的血红粒子团（成团分布 + 各自轨道漂移）
// 两层：backCloud（身后，较密）+ frontCloud（身前，稀疏细小不挡脸）
import * as THREE from 'three';

const OORT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uOpacity;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (150.0 / -mv.z);
    vA = uOpacity;
  }
`;

const OORT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

function makeCloud(scene, N, sizeMin, sizeMax, zCenter, opacityMax) {
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const orbit = [];
  const dark = new THREE.Color('#4a060e');
  const mid = new THREE.Color('#a3121d');
  const bright = new THREE.Color('#ff5a5a');

  // 成团分布：6 个云团中心，粒子高斯散布在中心附近
  const clusters = [];
  for (let c = 0; c < 6; c++) {
    clusters.push({
      th: Math.random() * Math.PI * 2,
      r: 0.5 + Math.random() * 0.5,
      y: (Math.random() - 0.5) * 1.4,
    });
  }

  for (let i = 0; i < N; i++) {
    const cl = clusters[i % clusters.length];
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    orbit.push({
      r: cl.r + gauss() * 0.22,
      th: cl.th + gauss() * 0.55,
      sp: (0.1 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1),
      y: cl.y + gauss() * 0.3,
      wob: Math.random() * Math.PI * 2,
      wobSp: 0.3 + Math.random() * 0.5,
    });
    const c = dark.clone().lerp(Math.random() < 0.75 ? mid : bright, Math.random());
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: OORT_VERT,
    fragmentShader: OORT_FRAG,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.z = zCenter;
  points.frustumCulled = false;
  scene.add(points);

  return {
    points,
    mat,
    opacityMax,
    update(t, delta, visible) {
      const target = visible ? opacityMax : 0;
      mat.uniforms.uOpacity.value += (target - mat.uniforms.uOpacity.value) * Math.min(1, delta * 2.2);
      points.visible = mat.uniforms.uOpacity.value > 0.02;
      if (!points.visible) return;
      const pos = geo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const o = orbit[i];
        o.th += o.sp * delta;
        const y = o.y + Math.sin(t * o.wobSp + o.wob) * 0.05;
        pos[i * 3] = Math.cos(o.th) * o.r;
        pos[i * 3 + 1] = y + 0.85; // 以身体中心为基准
        pos[i * 3 + 2] = Math.sin(o.th) * o.r * 0.55; // 椭球：前后向压扁
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

export function createOort(scene) {
  const back = makeCloud(scene, 720, 1.4, 3.6, -0.4, 0.85);
  const front = makeCloud(scene, 240, 1.0, 2.2, 0.22, 0.5);
  return {
    update(t, delta, visible) {
      back.update(t, delta, visible);
      front.update(t, delta, visible);
    },
  };
}
