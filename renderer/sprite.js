// 红后立绘图层：姿势 + 嘴巴开合帧（说话时口型随音量驱动）
// 文件：idle / greet / talk（闭嘴）/ talk-open（张嘴），加载失败回退 VRM
import * as THREE from 'three';

export async function createSprites(scene, height = 1.62) {
  const loader = new THREE.TextureLoader();
  const load = async (f) => {
    const tex = await loader.loadAsync(f);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const idle = await load('../assets/sprite-idle.png');
  const greet = await load('../assets/sprite-greet.png');
  const talkClosed = await load('../assets/sprite-talk.png');
  let talkOpen = null;
  try {
    talkOpen = await load('../assets/sprite-talk-open.png');
  } catch {
    talkOpen = null; // 没有张嘴帧则退化为姿势交替
  }

  const aspect = idle.image.width / idle.image.height;
  const geo = new THREE.PlaneGeometry(height * aspect, height);
  const mat = new THREE.MeshBasicMaterial({ map: idle, transparent: true, depthWrite: false, opacity: 0.92 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, height / 2, 0.12);
  mesh.visible = false;
  scene.add(mesh);

  let curTex = idle;
  let mouth = { vol: 0 };
  let greetLeft = 0;
  let lastSwap = 0;

  const setTex = (tex) => {
    if (tex && tex !== curTex) {
      curTex = tex;
      mat.map = tex;
      mat.needsUpdate = true;
    }
  };

  function update(t, delta, state, level) {
    const targetOpacity = state >= 2 ? 0.92 : 0;
    mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, delta * 3.2);
    mesh.visible = mat.opacity > 0.02;

    if (state === 3) {
      greetLeft = greetLeft > 0 ? greetLeft - delta : 0;
      if (greetLeft > 0) {
        setTex(greet);
      } else if (talkOpen) {
        // 口型：音量超阈值→张嘴帧，且最短保持 70ms 防止高频抖闪
        const wantOpen = mouth.vol > 0.09;
        if (t - lastSwap > 0.07) {
          setTex(wantOpen ? talkOpen : talkClosed);
          lastSwap = t;
        }
      } else {
        // 无张嘴帧：手势交替模拟
        setTex(((t * 1.4) % 1.1) > 0.55 ? talkClosed : idle);
      }
    } else if (state === 2) {
      greetLeft = 0.9; // 下一轮开口先打招呼
      setTex(greet); // 稳定展示，粒子云负责动感
    } else {
      greetLeft = 0;
      setTex(idle);
    }

    mesh.position.set(0, height / 2 + Math.sin(t * 0.8) * 0.008 + level * 0.012, 0.12);
    const bounce = 1 + level * 0.015;
    mesh.scale.set(bounce, 2 - bounce, 1);
  }

  return {
    mesh,
    update,
    setMouth: (m) => { if (m) Object.assign(mouth, m); },
    height,
    yCore: height * 0.62,
    fullBody: true,
  };
}
