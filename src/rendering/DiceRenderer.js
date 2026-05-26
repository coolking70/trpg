/**
 * 3D骰子渲染器
 * 使用Three.js渲染完整DND骰子套装（D4/D6/D8/D10/D12/D20）
 * 支持投掷动画和结果展示
 */

import * as THREE from 'three';

/** 骰子面数到几何体的映射配置 */
const DICE_CONFIG = {
  4: { name: 'D4', color: 0x22c55e, createGeometry: () => new THREE.TetrahedronGeometry(1.2) },
  6: { name: 'D6', color: 0x3b82f6, createGeometry: () => new THREE.BoxGeometry(1.4, 1.4, 1.4) },
  8: { name: 'D8', color: 0xa855f7, createGeometry: () => new THREE.OctahedronGeometry(1.2) },
  10: { name: 'D10', color: 0xf59e0b, createGeometry: () => createD10Geometry() },
  12: { name: 'D12', color: 0xef4444, createGeometry: () => new THREE.DodecahedronGeometry(1.2) },
  20: { name: 'D20', color: 0x06b6d4, createGeometry: () => new THREE.IcosahedronGeometry(1.2) },
};

/**
 * 创建D10（十面体）几何体
 * 使用双锥体近似
 */
function createD10Geometry() {
  const geometry = new THREE.CylinderGeometry(0, 1.2, 1.6, 10, 1);
  // 创建上下两个锥体合并的效果
  const topGeo = new THREE.ConeGeometry(1.2, 0.8, 10);
  topGeo.translate(0, 0.8, 0);
  const bottomGeo = new THREE.ConeGeometry(1.2, 0.8, 10);
  bottomGeo.rotateX(Math.PI);
  bottomGeo.translate(0, -0.8, 0);

  // 使用简单的二十面体代替（视觉效果更好）
  return new THREE.IcosahedronGeometry(1.1, 0);
}

export class DiceRenderer {
  /**
   * @param {HTMLElement} container - 骰子覆盖层容器
   */
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.diceMesh = null;
    this.isAnimating = false;
    this.animationFrameId = null;

    // 动画参数
    this.rotationSpeed = { x: 0, y: 0, z: 0 };
    this.targetRotation = { x: 0, y: 0, z: 0 };
    this.animationPhase = 'idle'; // idle | rolling | settling | showing
    this.animationTimer = 0;

    // 结果显示元素
    this.resultElement = null;

    this._animate = this._animate.bind(this);
  }

  /** 初始化Three.js场景；resultElement 每次 init 都重建（被 _finishAnimation 抹掉过） */
  init() {
    if (this.scene && this.resultElement) return;
    if (this.scene) {
      // 场景在，只重建结果元素
      this._buildResultElement();
      return;
    }

    // 场景
    this.scene = new THREE.Scene();

    // 相机
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(300, 300);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-65%);pointer-events:none;';

    // 光照
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(2, 3, 4);
    this.scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0x8b5cf6, 0.3);
    backLight.position.set(-2, -1, -3);
    this.scene.add(backLight);

    this._buildResultElement();
  }

  _buildResultElement() {
    // 大号结果数字（叠在骰子上方中央，最显眼）
    this.resultElement = document.createElement('div');
    this.resultElement.className = 'dice-result';
    this.resultElement.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 96px;
      font-weight: 900;
      color: #fff;
      text-shadow:
        0 0 28px rgba(139,92,246,0.95),
        0 0 12px rgba(255,255,255,0.7),
        0 4px 10px rgba(0,0,0,0.85);
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
      font-family: 'Segoe UI', sans-serif;
      text-align: center;
      line-height: 1;
      letter-spacing: 0.02em;
    `;
  }

  /**
   * 播放骰子投掷动画
   * @param {object} diceResult - DiceSystem返回的结果
   * @returns {Promise<void>} 动画完成后resolve
   */
  async animateRoll(diceResult) {
    if (this.isAnimating) return;

    this.init();
    this.isAnimating = true;

    const sides = diceResult.sides || 6;
    const config = DICE_CONFIG[sides] || DICE_CONFIG[6];

    // 清除旧骰子
    if (this.diceMesh) {
      this.scene.remove(this.diceMesh);
      this.diceMesh.geometry.dispose();
      this.diceMesh.material.dispose();
    }

    // 创建新骰子
    const geometry = config.createGeometry();
    const material = new THREE.MeshPhongMaterial({
      color: config.color,
      shininess: 80,
      specular: 0x444444,
      flatShading: true,
    });
    this.diceMesh = new THREE.Mesh(geometry, material);

    // 给每个面添加边框线
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    this.diceMesh.add(wireframe);

    this.scene.add(this.diceMesh);

    // 挂载到DOM
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);
    this.container.appendChild(this.resultElement);
    this.container.classList.add('active');

    // 设置随机初始旋转
    this.diceMesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    // 随机旋转速度
    this.rotationSpeed = {
      x: (Math.random() - 0.5) * 20,
      y: (Math.random() - 0.5) * 20,
      z: (Math.random() - 0.5) * 15,
    };

    // 隐藏结果
    this.resultElement.style.opacity = '0';
    this.resultElement.textContent = '';

    // 开始动画
    this.animationPhase = 'rolling';
    this.animationTimer = 0;

    return new Promise(resolve => {
      this._resolve = resolve;
      this._diceResult = diceResult;
      this._startTime = performance.now();
      this._animate();
    });
  }

  /** 动画循环 */
  _animate() {
    if (!this.isAnimating) return;

    const elapsed = (performance.now() - this._startTime) / 1000;

    if (this.diceMesh) {
      if (this.animationPhase === 'rolling') {
        // 高速旋转阶段（0-1.2秒）
        this.diceMesh.rotation.x += this.rotationSpeed.x * 0.016;
        this.diceMesh.rotation.y += this.rotationSpeed.y * 0.016;
        this.diceMesh.rotation.z += this.rotationSpeed.z * 0.016;

        // 逐渐减速
        this.rotationSpeed.x *= 0.98;
        this.rotationSpeed.y *= 0.98;
        this.rotationSpeed.z *= 0.98;

        // 弹跳效果
        this.diceMesh.position.y = Math.abs(Math.sin(elapsed * 8)) * (1.5 - elapsed) * 0.5;

        if (elapsed > 1.2) {
          this.animationPhase = 'settling';
        }
      } else if (this.animationPhase === 'settling') {
        // 减速到停止（1.2-2秒）
        this.rotationSpeed.x *= 0.92;
        this.rotationSpeed.y *= 0.92;
        this.rotationSpeed.z *= 0.92;

        this.diceMesh.rotation.x += this.rotationSpeed.x * 0.016;
        this.diceMesh.rotation.y += this.rotationSpeed.y * 0.016;
        this.diceMesh.rotation.z += this.rotationSpeed.z * 0.016;

        // 下落到桌面
        this.diceMesh.position.y = Math.max(0, this.diceMesh.position.y - 0.05);

        if (elapsed > 2.0) {
          this.animationPhase = 'showing';

          // 拼装结果文本：大号点数 + 公式 + 判定结果
          const result = this._diceResult;
          const total = result.total;
          const formula = result.formula || '';
          const subTextParts = [];
          if (formula) subTextParts.push(formula);
          if (result.modifier !== undefined && result.modifier !== 0) {
            subTextParts.push(`${result.subtotal}${result.modifier >= 0 ? '+' : ''}${result.modifier}`);
          }
          let badge = '';
          if (result.target !== undefined) {
            badge = result.success
              ? `<span style="color:#4ade80;font-size:24px;margin-left:8px;text-shadow:0 0 12px rgba(74,222,128,0.8)">✓ 成功</span>`
              : `<span style="color:#f87171;font-size:24px;margin-left:8px;text-shadow:0 0 12px rgba(248,113,113,0.8)">✗ 失败</span>`;
          }
          this.resultElement.innerHTML = `
            <div style="font-size:14px;color:#cbd5e1;margin-bottom:6px;font-weight:500;letter-spacing:0.04em;text-shadow:0 2px 4px rgba(0,0,0,0.6)">${subTextParts.join(' · ')}</div>
            <div style="display:flex;align-items:baseline;justify-content:center">${total}${badge}</div>
          `;
          this.resultElement.style.opacity = '1';
          this.resultElement.style.transform = 'translate(-50%, -50%) scale(1.0)';
          // 弹一下
          requestAnimationFrame(() => {
            this.resultElement.style.transform = 'translate(-50%, -50%) scale(1.1)';
            setTimeout(() => {
              if (this.resultElement) this.resultElement.style.transform = 'translate(-50%, -50%) scale(1.0)';
            }, 180);
          });
        }
      } else if (this.animationPhase === 'showing') {
        // 缓慢自转展示，同时骰子逐渐淡出 — 让中央的数字凸显出来
        this.diceMesh.rotation.y += 0.01;
        const showElapsed = elapsed - 2.0;  // 从进入 showing 起算
        // 0~1.2 秒保持，1.2~1.8 秒淡出
        const fadeStart = 1.2, fadeDur = 0.6;
        if (showElapsed > fadeStart) {
          const t = Math.min(1, (showElapsed - fadeStart) / fadeDur);
          const opacity = 1 - t;
          if (this.diceMesh.material) {
            this.diceMesh.material.transparent = true;
            this.diceMesh.material.opacity = opacity;
            // 边框也跟随
            this.diceMesh.children.forEach(ch => {
              if (ch.material) {
                ch.material.transparent = true;
                ch.material.opacity = opacity * 0.3;
              }
            });
          }
        }

        // 展示总时长 1.8 秒后结束（原来 1.5 秒，稍延一点让玩家看清）
        if (showElapsed > 1.8) {
          this._finishAnimation();
          return;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this._animate);
  }

  /** 结束动画：渐出 → 清掉 canvas/结果元素 → 清空 WebGL framebuffer */
  _finishAnimation() {
    this.isAnimating = false;
    this.animationPhase = 'idle';

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // 立刻让结果数字开始淡出（与下方的清理并行）
    if (this.resultElement) this.resultElement.style.opacity = '0';

    // 300ms 后做实质清理：把骰子/canvas/result 从 DOM 拿掉，并清空 WebGL
    setTimeout(() => {
      // 把骰子从场景移除，避免下一次显示时残留旧网格
      if (this.diceMesh && this.scene) {
        this.scene.remove(this.diceMesh);
        try { this.diceMesh.geometry.dispose(); } catch { /* */ }
        try { this.diceMesh.material.dispose(); } catch { /* */ }
        this.diceMesh = null;
      }

      // 把容器清干净 — canvas 和 resultElement 都被一并移除
      if (this.container) {
        this.container.classList.remove('active');
        this.container.innerHTML = '';
      }

      // 清空 WebGL framebuffer，下次显示时是干净的初始帧
      if (this.renderer) {
        this.renderer.clear();
      }

      // resultElement 现在已经脱离 DOM，下次 animateRoll 会重建
      this.resultElement = null;

      if (this._resolve) {
        this._resolve();
        this._resolve = null;
      }
    }, 280);
  }

  /** 立即停止动画 */
  stopAnimation() {
    if (!this.isAnimating) return;
    this._finishAnimation();
  }

  /** 销毁渲染器 */
  destroy() {
    this.stopAnimation();

    if (this.diceMesh) {
      this.scene.remove(this.diceMesh);
      this.diceMesh.geometry.dispose();
      this.diceMesh.material.dispose();
      this.diceMesh = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.container.innerHTML = '';
  }
}
