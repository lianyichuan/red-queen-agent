// 红后：全息投影少女（VRM + 全息 shader + 音频频段口型同步 aa/ih/ou/ee/oh）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const HOLO_VERT = /* glsl */ `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  uniform float uTime, uGlitch;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    // 水平切片故障：随机时间窗内整行错位
    {
      float band = floor(transformed.y * 22.0);
      float gate = step(0.8, fract(sin(band * 91.7 + floor(uTime * 7.0) * 13.1) * 43758.5));
      transformed.x += uGlitch * gate * 0.035 * (fract(sin(band * 45.7 + floor(uTime * 7.0)) * 789.5) - 0.5) * 2.0;
    }
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vN = normalize(mat3(modelMatrix) * objectNormal);
    vV = normalize(cameraPosition - wp.xyz);
    vY = wp.y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const HOLO_FRAG = /* glsl */ `
  uniform float uTime, uLevel, uReveal, uMinY, uMaxY;
  uniform vec3 uColor;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.9);
    float scan = 0.55 + 0.45 * sin(vY * 150.0 - uTime * 9.0);
    float vYn = clamp((vY - uMinY) / max(0.001, uMaxY - uMinY), 0.0, 1.0);
    float vis = 1.0 - smoothstep(uReveal - 0.02, uReveal + 0.07, vYn);   // 显形线以下可见
    float edge = exp(-abs(vYn - uReveal) * 26.0) * 2.2;                  // 显形线辉光
    float a = (0.30 + fres * 0.85 + scan * 0.10 + uLevel * 0.25) * vis + edge * vis;
    vec3 col = uColor * (0.45 + fres * 1.5 + uLevel * 0.7 + edge * 0.8);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

export async function createFigure(scene) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync('../assets/redqueen.vrm');
  const vrm = gltf.userData.vrm;

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (typeof VRMUtils.combineSkeletons === 'function') VRMUtils.combineSkeletons(gltf.scene);
  else if (typeof VRMUtils.removeUnnecessaryJoints === 'function') VRMUtils.removeUnnecessaryJoints(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM0 模型朝向修正

  const holo = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uReveal: { value: -0.1 },
      uGlitch: { value: 0 },
      uMinY: { value: 0 },
      uMaxY: { value: 1 },
      uColor: { value: new THREE.Color('#d92f3f') },
    },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // 普通混合：浅色壁纸上也能看清（加色混合会曝白）
    blending: THREE.NormalBlending,
  });

  vrm.scene.traverse((obj) => {
    if (obj.isMesh) {
      obj.material = holo;
      obj.frustumCulled = false;
    }
  });

  // 包围盒 → 显形范围 / 相机取景参数
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const height = size.y || 1.5;
  const yCore = box.min.y + height * 0.62; // 胸口核心位置
  holo.uniforms.uMinY.value = box.min.y;
  holo.uniforms.uMaxY.value = box.max.y;

  const group = new THREE.Group();
  group.add(vrm.scene);
  group.visible = false;
  scene.add(group);

  /* ---------------- 口型同步 ---------------- */
  const expr = vrm.expressionManager || null;
  const exprMap = expr ? expr.expressionMap || {} : {};
  if (expr) console.log('[javis] 口型可用:', Object.keys(exprMap).join(', '));
  const mouth = { vol: 0, low: 0, mid: 0, high: 0 }; // app.js 喂的频段
  const cur = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }; // 当前口型权重

  function setMouth(m) {
    if (m) Object.assign(mouth, m);
  }

  function applyMouth(delta, speaking) {
    if (!expr) return;
    let tgt;
    if (speaking && group.visible) {
      const v = Math.min(1, mouth.vol * 2.4);
      tgt = {
        aa: clamp01(v * (0.35 + mouth.low * 1.2 + mouth.mid)),          // 开口： broadband
        ou: clamp01(v * (mouth.low * 1.9 - mouth.mid * 0.5)),           // 圆唇：低频主导
        ih: clamp01(v * (mouth.high * 2.3 - mouth.low * 0.3)),          // 扁唇：高频主导
        ee: clamp01(v * (mouth.mid * 1.8 - mouth.low * 0.7)),           // 展唇：中频
        oh: 0,
      };
      tgt.oh = clamp01(Math.min(tgt.aa, tgt.ou) * 0.9);
    } else {
      tgt = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }; // 闭嘴
    }
    const k = Math.min(1, delta * 16);
    for (const name of VISEMES) {
      cur[name] += (tgt[name] - cur[name]) * k;
      if (exprMap[name]) expr.setValue(name, cur[name]);
    }
  }

  // 待机漂浮 + 播报微摆
  function update(t, delta, state, level) {
    holo.uniforms.uTime.value = t;
    holo.uniforms.uLevel.value = level;
    const revealTarget = state >= 2 ? 1.15 : -0.1;
    holo.uniforms.uReveal.value += (revealTarget - holo.uniforms.uReveal.value) * Math.min(1, delta * 3.2);
    group.visible = holo.uniforms.uReveal.value > 0.01;

    // 故障抖动：工作/播报时随机触发短脉冲
    if (state >= 2 && Math.random() < delta * 0.9) holo.uniforms.uGlitch.value = 0.9;
    holo.uniforms.uGlitch.value *= Math.pow(0.001, delta);

    applyMouth(delta, state === 3);

    vrm.scene.rotation.y = Math.sin(t * (state === 3 ? 0.5 : 0.22)) * 0.06;
    group.position.y = Math.sin(t * 0.8) * 0.006;

    vrm.update(delta);
  }

  return { group, update, setMouth, height, yCore, minY: box.min.y };
}
