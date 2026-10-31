// Identity-matched cinematic poses, revealed through a narrow projection scan.
import * as THREE from 'three';
const canvas = document.getElementById('orb');
const stage = document.getElementById('stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let state = 0;
let targetLevel = 0;
let hover = false;
let reveal = 0;
let level = 0;
let renderer;
let material;
let particles;
let observer;
let raf;
let lastFrame = 0;
let lastTime = 0;
let time = 0;
let ready = false;
const poseFiles = ['idle', 'scrutiny', 'command', 'takeover', 'speaking'];
let stateSince = performance.now();
let poseOverride = null;
let poseFrom = 0;
let poseTo = 0;
let poseBlend = 1;
let textures = [];
const fallback = document.getElementById('portrait-fallback');
function desiredPose(now) {
  if (poseOverride !== null) return poseOverride;
  if (state === 1 || state === 4) return 1;
  if (state === 2) return now - stateSince > 4200 ? 3 : 2;
  return state === 3 ? 4 : 0;
}
function showPose(index) {
  fallback.src = `../assets/poses/${poseFiles[index]}.png`;
  stage.dataset.pose = poseFiles[index];
}
const pointer = new THREE.Vector2();
const pointerTarget = new THREE.Vector2();
window.javisOrb = {
  setState(value) {
    if (state !== value) stateSince = performance.now();
    state = value; poseOverride = null;
    showPose(desiredPose(performance.now()));
  },
  // Preview controls change only the picture, never execution or permissions.
  setPose(name) {
    const index = poseFiles.indexOf(name);
    if (index < 0) return;
    poseOverride = index; showPose(index);
  },
  setLevel(value) { targetLevel = Math.max(0, Math.min(1, value)); },
  // Still portraits are not a rigged face or viseme animation.
  setMouth() {},
  setHover(value) { hover = value; },
};
window.dispatchEvent(new Event('javis:visual-ready'));

const vertex = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uLevel;
  uniform vec2 uPointer;
  void main() {
    vUv = uv;
    vec3 p = position;
    float depth = sin(uv.x * 3.14159) * sin(uv.y * 3.14159);
    p.x += uPointer.x * depth * .085;
    p.y += sin(uTime * .75) * .006 + uPointer.y * depth * .035;
    p.z += depth * .14;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const fragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPortrait;
  uniform sampler2D uNextPortrait;
  uniform float uPoseBlend;
  uniform float uTime;
  uniform float uReveal;
  uniform float uActivity;
  uniform float uLevel;
  uniform float uMotion;
  void main() {
    vec2 uv = vUv;
    // A rare, thin signal slip during execution; never moves the whole face.
    float pulse = smoothstep(.9992, 1.0, sin(uTime * .67));
    float band = 1.0 - smoothstep(.0, .013, abs(uv.y - fract(uTime * .037)));
    uv.x += pulse * band * .005 * uActivity * uMotion;
    // A narrow scan wipe avoids double-exposed faces during transitions.
    float edge = (1.0 - uPoseBlend) * 1.10 - .05;
    float blend = smoothstep(edge - .035, edge + .035, uv.y);
    vec4 source = mix(texture2D(uPortrait, uv), texture2D(uNextPortrait, uv), blend);
    if (source.a < .008) discard;
    float lum = clamp(max(source.r, max(source.g, source.b)), 0.0, 1.0);
    float detail = pow(lum, .66);
    vec3 color = mix(vec3(.12, .004, .018), vec3(1.0, .21, .26), detail);
    // Neighbouring luminance and alpha recover a fine luminous silhouette and
    // facial contours from the still, without flattening the photographic detail.
    vec2 texel = vec2(.0022, .0016);
    vec4 left = mix(texture2D(uPortrait, uv - vec2(texel.x, 0.)), texture2D(uNextPortrait, uv - vec2(texel.x, 0.)), blend);
    vec4 right = mix(texture2D(uPortrait, uv + vec2(texel.x, 0.)), texture2D(uNextPortrait, uv + vec2(texel.x, 0.)), blend);
    float contour = abs(left.r - right.r) * .6 + abs(left.a - right.a) * .8;
    color += vec3(1., .22, .38) * contour * .9;
    float scan = .92 + .08 * sin(gl_FragCoord.y * 2.09);
    float grid = .97 + .03 * sin(gl_FragCoord.x * 2.09);
    float movingLine = exp(-pow((uv.y - fract(uTime * .063)) * 160.0, 2.0));
    color += vec3(.32, .08, .13) * movingLine * uMotion;
    color *= scan * grid * (.94 + .08 * uLevel);
    float bottomFade = smoothstep(.015, .20, uv.y);
    float topFade = 1.0 - smoothstep(.97, 1.0, uv.y);
    float reveal = smoothstep(uv.y - .035, uv.y + .035, uReveal * 1.12);
    float alpha = source.a * bottomFade * topFade * reveal * (.70 + detail * .27);
    alpha *= .97 + .03 * sin(uTime * .8) * uMotion;
    gl_FragColor = vec4(color, alpha);
  }
`;

function seededRandom() {
  let seed = 271828;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
function createParticles(scene) {
  const random = seededRandom();
  const count = 400;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const radius = .36 + random() * .45;
    positions.set([Math.cos(angle) * radius, (random() - .5) * 1.65, -.12 - random() * .15], i * 3);
    phases[i] = random() * Math.PI * 2;
    sizes[i] = .45 + random() * .8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float aPhase; attribute float aSize; uniform float uTime; uniform float uOpacity; uniform float uPixelRatio; varying float vOpacity;
      void main() { vec3 p = position; p.x += sin(uTime * .16 + aPhase) * .025; p.y += sin(uTime * .23 + aPhase) * .02;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); gl_PointSize = aSize * uPixelRatio; vOpacity = uOpacity * (.35 + .65 * pow(sin(aPhase + uTime * .35), 2.0)); }`,
    fragmentShader: `varying float vOpacity; void main() { float d = length(gl_PointCoord - .5); float a = (1.0 - smoothstep(.05, .5, d)) * vOpacity; gl_FragColor = vec4(1.0, .27, .33, a); }`,
    transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geometry, mat);
  scene.add(points);
  return points;
}

async function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setClearColor(0, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 3;
    const loader = new THREE.TextureLoader();
    const texture = await loader.loadAsync('../assets/poses/idle.png');
    texture.colorSpace = THREE.SRGBColorSpace;
    textures = await Promise.all(poseFiles.map(async (name, index) => {
      if (index === 0) return texture;
      try {
        const pose = await loader.loadAsync(`../assets/poses/${name}.png`);
        pose.colorSpace = THREE.SRGBColorSpace;
        return pose;
      } catch (error) {
        console.warn(`[javis] Pose ${name} unavailable; keeping idle.`, error.message);
        return texture;
      }
    }));
    const portraitAspect = texture.image.width / texture.image.height;
    material = new THREE.ShaderMaterial({
      uniforms: {
        uPortrait: { value: texture },
        uNextPortrait: { value: texture }, uPoseBlend: { value: 1 },
        uTime: { value: 0 }, uLevel: { value: 0 }, uReveal: { value: 0 },
        uActivity: { value: 0 }, uMotion: { value: reduce.matches ? 0 : 1 }, uPointer: { value: pointer },
      },
      vertexShader: vertex, fragmentShader: fragment,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(1.87 * portraitAspect, 1.87, 24, 32), material);
    portrait.position.y = .015;
    scene.add(portrait);
    particles = createParticles(scene);
    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.left = -w / h;
      camera.right = w / h;
      camera.updateProjectionMatrix();
    }
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    stage.addEventListener('pointermove', (event) => {
      const rect = stage.getBoundingClientRect();
      pointerTarget.set((event.clientX - rect.left) / rect.width - .5, .5 - (event.clientY - rect.top) / rect.height);
    });
    stage.addEventListener('pointerleave', () => pointerTarget.set(0, 0));
    reduce.addEventListener('change', () => { material.uniforms.uMotion.value = reduce.matches ? 0 : 1; });
    const animate = (now) => {
      raf = requestAnimationFrame(animate);
      if (document.hidden || !stage.clientWidth || !stage.clientHeight) { lastTime = now; return; }
      const interval = state === 2 || state === 3 || hover ? 1000 / 45 : 1000 / 24;
      if (now - lastFrame < interval) return;
      const delta = Math.min(.06, (now - (lastTime || now)) / 1000);
      lastFrame = now;
      lastTime = now;
      if (!reduce.matches) time += delta;
      const damp = 1 - Math.exp(-delta * 6);
      const requested = desiredPose(now);
      if (poseBlend >= 1 && requested !== poseTo) {
        poseFrom = poseTo;
        poseTo = requested;
        poseBlend = 0;
        material.uniforms.uPortrait.value = textures[poseFrom];
        material.uniforms.uNextPortrait.value = textures[poseTo];
        showPose(poseTo);
      }
      poseBlend = reduce.matches ? 1 : Math.min(1, poseBlend + delta / .72);
      material.uniforms.uPoseBlend.value = poseBlend * poseBlend * (3 - 2 * poseBlend);
      level += (targetLevel - level) * (1 - Math.exp(-delta * 14));
      reveal += (1 - reveal) * (1 - Math.exp(-delta * 3.6));
      pointer.lerp(reduce.matches ? new THREE.Vector2() : pointerTarget, damp);
      portrait.rotation.y = pointer.x * .09;
      portrait.rotation.x = -pointer.y * .045;
      material.uniforms.uTime.value = time;
      material.uniforms.uReveal.value = reduce.matches ? 1 : reveal;
      material.uniforms.uLevel.value = level;
      material.uniforms.uActivity.value += ((state === 2 ? 1 : 0) - material.uniforms.uActivity.value) * damp;
      particles.material.uniforms.uTime.value = time;
      const targetOpacity = reduce.matches ? 0 : state === 2 ? .45 : state === 3 ? .25 + level * .12 : .12;
      particles.material.uniforms.uOpacity.value += (targetOpacity - particles.material.uniforms.uOpacity.value) * damp;
      renderer.render(scene, camera);
      if (!ready && reveal > .15) {
        document.getElementById('panel').classList.add('webgl-ready');
        ready = true;
      }
    };
    raf = requestAnimationFrame(animate);
    // Keep the still fallback if a GPU/context failure occurs.
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
      document.getElementById('panel').classList.remove('webgl-ready');
      console.warn('[javis] GPU context lost; showing portrait fallback.');
    });
    window.addEventListener('beforeunload', () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      portrait.geometry.dispose(); material.dispose();
      new Set(textures).forEach(texture => texture.dispose());
      particles.geometry.dispose(); particles.material.dispose(); renderer.dispose();
    }, { once: true });
    console.log('[javis] Red Queen projection ready');
  } catch (error) {
    console.warn('[javis] WebGL unavailable; using portrait fallback:', error.message);
  }
}
init();
