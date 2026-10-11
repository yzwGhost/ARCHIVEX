import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ArchiveContactPass } from './ArchiveContactPass.ts';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ArchiveModel, createModelAssets } from './ArchiveModel.ts';
import { MotionValue } from './ArchiveMotion.ts';
import { archiveWave } from './ArchiveWave.ts';
import { layoutFiles } from '../layout.ts';
import type { ArchiveState } from '../archive-state.ts';
import type { ArchiveEntry } from '../types.ts';

interface WorldCallbacks { activate(index: number): void; fallback(): void; introEnd(): void }

export class ArchiveWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-10, 10, 6, -6, .1, 140);
  private scene = new THREE.Scene();
  private models: ArchiveModel[];
  private positions: ReturnType<typeof layoutFiles>;
  private controls: OrbitControls;
  private state: ArchiveState | undefined;
  private observer: ResizeObserver;
  private animation = 0;
  private disposed = false;
  private previousTime = performance.now();
  private selected = 0;
  private mode = 'overview';
  private aspect = 1;
  private introStart = -10000;
  private introActive = false;
  private depth = new MotionValue(0);
  private explosion = new MotionValue(0);
  private lift: MotionValue[];
  private cameraPosition = new THREE.Vector3(12, 14, 17);
  private cameraTarget = new THREE.Vector3();
  private cameraSize = 10;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerStart: { x: number; y: number; index: number; id: number } | null = null;
  private onIntroEnd: () => void;
  private cleanup: (() => void)[] = [];
  private ambient: THREE.InstancedMesh | undefined;
  private ambientPositions: {x: number; z: number}[] = [];
  private instanceMatrix = new THREE.Matrix4();
  private environment: THREE.WebGLRenderTarget;
  private keyLight: THREE.DirectionalLight;
  private composer: EffectComposer;
  private contactShading: ArchiveContactPass;

  constructor(container: HTMLElement, entries: ArchiveEntry[], callbacks: WorldCallbacks) {
    this.onIntroEnd = callbacks.introEnd;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.setClearColor('#eeece5');
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const canvas = this.renderer.domElement;
    canvas.className = 'archive-canvas'; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '立体档案阵列，点击选中，再次点击查看详情；方向键切换档案，Enter 打开');
    container.append(canvas);
    this.scene.background = new THREE.Color('#eeece5');
    this.scene.fog = new THREE.Fog('#eeece5', 22, 57);
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(studio, .06);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .40;
    studio.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#fffdf7', '#c4bba8', 2.0));
    const key = this.keyLight = new THREE.DirectionalLight('#fff7e8', 2.2);
    key.position.set(-10, 20, 10); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -22; key.shadow.camera.right = 22;
    key.shadow.camera.top = 22; key.shadow.camera.bottom = -22; key.shadow.camera.far = 65;
    key.shadow.bias = -.00015; key.shadow.normalBias = .018;
    key.shadow.radius = 3.75; key.shadow.blurSamples = 8; key.shadow.intensity = .72;
    this.scene.add(key, key.target);
    this.scene.add(new THREE.AmbientLight('#fffdf7', .25));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#eeeae1', roughness: .96 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.03; ground.receiveShadow = true; this.scene.add(ground);
    this.positions = layoutFiles(entries.length);
    const assets = createModelAssets();
    this.models = entries.map((entry, index) => {
      const model = new ArchiveModel(entry, index, assets);
      const p = this.positions[index]; model.group.position.set(p.x, 0, p.z);
      this.scene.add(model.group); return model;
    });
    this.lift = entries.map(() => new MotionValue(0));
    // Unnumbered distant silhouettes extend the composition, never the document inventory.
    if (entries.length > 8) {
      const transforms: THREE.Matrix4[] = [];
      for (let row = -2; row < Math.ceil(entries.length / 8) + 3; row++) {
        for (let slot = -12; slot < 20; slot++) {
          if (row >= 0 && row < Math.ceil(entries.length / 8) && slot >= 0 && slot < 8) continue;
          transforms.push(new THREE.Matrix4().makeTranslation((slot - 3.5) * .48, 1.36, -row * 4.6));
          this.ambientPositions.push({x: (slot - 3.5) * .48, z: -row * 4.6});
        }
      }
      this.ambient = new THREE.InstancedMesh(new RoundedBoxGeometry(.23, 2.72, 3.72, 2, .045), assets.ivory, transforms.length);
      this.ambient.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.ambient.frustumCulled = false;
      transforms.forEach((matrix, index) => this.ambient!.setMatrixAt(index, matrix));
      this.ambient.receiveShadow = true; this.ambient.castShadow = true; this.scene.add(this.ambient);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.dampingFactor = .07;
    this.controls.enablePan = false; this.controls.minZoom = .7; this.controls.maxZoom = 2.1;
    this.controls.minPolarAngle = .22; this.controls.maxPolarAngle = Math.PI - .22;
    this.composer = new EffectComposer(this.renderer);
    this.composer.renderTarget1.samples = 4;
    this.composer.renderTarget2.samples = 4;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.contactShading = new ArchiveContactPass(this.scene, this.camera);
    this.contactShading.prepareOpaqueMeshes();
    this.contactShading.blendIntensity = .38;
    this.contactShading.updateGtaoMaterial({radius: .42, thickness: .22, scale: 1, samples: 8, distanceFallOff: .7, screenSpaceRadius: false});
    this.contactShading.updatePdMaterial({radius: 5, samples: 8, rings: 2});
    this.composer.addPass(this.contactShading);
    this.composer.addPass(new OutputPass());
    // The normal prepass reuses the beauty pass's shadows instead of rendering them twice.
    this.renderer.shadowMap.autoUpdate = false;
    const resize = () => {
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
      this.aspect = width / height; this.renderer.setSize(width, height, false); this.projection();
      this.composer.setSize(width, height);
      this.contactShading.setSize(Math.ceil(width * .7), Math.ceil(height * .7));
    };
    this.observer = new ResizeObserver(resize); this.observer.observe(container); resize();
    const hit = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.models.map(model => model.group), true);
      for (const intersection of hits) {
        let object: THREE.Object3D | null = intersection.object;
        while (object && typeof object.userData.entryIndex !== 'number') object = object.parent;
        if (object) return object.userData.entryIndex as number;
      }
      return -1;
    };
    const move = (event: PointerEvent) => {
      if (this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) this.pointerStart = null;
      if (!this.state || this.state.mode !== 'overview' || this.state.overlay || this.state.reading || this.introActive) return;
      const index = hit(event); canvas.style.cursor = index >= 0 ? 'pointer' : 'default';
    };
    const down = (event: PointerEvent) => {
      this.pointerStart = event.button === 0 && event.isPrimary && this.mode === 'overview' && !this.state?.overlay && !this.state?.reading && !this.introActive
        ? { x: event.clientX, y: event.clientY, index: hit(event), id: event.pointerId } : null;
    };
    const up = (event: PointerEvent) => {
      const start = this.pointerStart; this.pointerStart = null;
      if (!start || start.id !== event.pointerId || event.button !== 0 || this.mode !== 'overview' || this.state?.overlay || this.state?.reading || this.introActive || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const index = hit(event); if (index >= 0 && index === start.index) callbacks.activate(index);
    };
    const lost = (event: Event) => { event.preventDefault(); this.dispose(); callbacks.fallback(); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up); canvas.addEventListener('webglcontextlost', lost);
    this.cleanup.push(() => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('webglcontextlost', lost); });
    const leave = () => { this.pointerStart = null; canvas.style.cursor = 'default'; };
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointercancel', leave);
    this.cleanup.push(() => { canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('pointercancel', leave); });
    this.camera.position.copy(this.cameraPosition);
    this.render(performance.now());
  }

  update(state: ArchiveState) {
    const now = performance.now();
    const oldSelected = this.selected;
    this.state = state; this.selected = state.selected;
    if (oldSelected !== this.selected || this.mode !== state.mode) {
      this.lift.forEach((motion, index) => motion.to(index === this.selected ? (state.mode === 'overview' ? 1.05 : 3.1) : 0, state.mode === 'overview' ? 480 : 1050, now));
    } else if (this.lift[this.selected]?.value(now) === 0) this.lift[this.selected]?.to(1.05, 480, now);
    if (this.mode !== state.mode) {
      if (this.mode === 'inspect') this.controls.enabled = false;
      this.mode = state.mode;
      this.depth.to(state.mode === 'overview' ? 0 : 1, state.mode === 'overview' ? 900 : 1150, now);
      this.resetting = state.mode === 'inspect';
    }
    this.controls.enabled = this.mode === 'inspect' && !state.overlay && !state.reading && !this.resetting;
    this.explosion.to(state.exploded ? 1 : 0, 850, now);
  }
  private resetting = false;
  resetView() { this.resetting = true; this.controls.enabled = false; }
  replayIntro() { this.introStart = performance.now(); this.introActive = true; }
  skipIntro() { if (!this.introActive) return; this.introActive = false; this.onIntroEnd(); }
  private projection() {
    this.camera.left = -this.cameraSize * this.aspect / 2; this.camera.right = this.cameraSize * this.aspect / 2;
    this.camera.top = this.cameraSize / 2; this.camera.bottom = -this.cameraSize / 2;
    this.camera.updateProjectionMatrix();
  }
  private render = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(.05, (now - this.previousTime) / 1000); this.previousTime = now;
    const blend = 1 - Math.exp(-dt * 4.2);
    const p = this.positions[this.selected] ?? { x: 0, y: 0, z: 0 };
    const detail = this.depth.value(now);
    const intro = this.introActive ? Math.min(1, (now - this.introStart) / 3600) : 1;
    if (this.introActive && intro >= 1) this.skipIntro();
    const explode = this.explosion.value(now);
    this.models.forEach((model, index) => {
      const position = this.positions[index];
      const isSelected = index === this.selected;
      const wave = archiveWave(position.x, position.z, now, detail);
      const enter = this.introActive ? Math.max(0, 1 - Math.max(0, intro * 1.4 - index * .006)) : 0;
      model.group.position.set(position.x, this.lift[index].value(now) + wave - enter * 5 - (isSelected ? 0 : detail * 3.8), position.z);
      model.group.visible = isSelected || detail < .998;
      model.update(isSelected ? explode : 0, isSelected, isSelected);
    });
    if (this.ambient) {
      this.ambient.position.y = -detail * 5 - (1 - intro) * 4;
      this.ambient.visible = detail < .995;
      if (this.ambient.visible) {
        this.ambientPositions.forEach((position, index) => {
          this.instanceMatrix.makeTranslation(position.x, 1.36 + archiveWave(position.x, position.z, now, detail), position.z);
          this.ambient!.setMatrixAt(index, this.instanceMatrix);
        });
        this.ambient.instanceMatrix.needsUpdate = true;
      }
    }
    // Keep the shadow volume and lighting direction consistent while navigating deep groups.
    this.keyLight.target.position.lerp(new THREE.Vector3(p.x, 0, p.z), blend);
    this.keyLight.position.copy(this.keyLight.target.position).add(new THREE.Vector3(-10, 20, 10));
    const narrow = this.aspect < 1;
    if (this.mode !== 'inspect' || this.resetting || detail < .99) {
      const origin = new THREE.Vector3(p.x, 1.8, p.z);
      const overviewTarget = origin.clone().add(narrow ? new THREE.Vector3(.1, 0, -.7) : new THREE.Vector3(1.9, 0, -2.3));
      const detailTarget = origin.clone().add(narrow ? new THREE.Vector3(0, -.1, 0) : new THREE.Vector3(.7, 2.25, -1.7));
      const inspectTarget = origin.clone().add(new THREE.Vector3(0, 2.66, 0));
      const target = overviewTarget.lerp(this.mode === 'inspect' ? inspectTarget : detailTarget, detail);
      const offset = new THREE.Vector3(12, 14, 17).lerp(new THREE.Vector3(12, 2.0, 3.1), detail);
      if (this.introActive) offset.add(new THREE.Vector3(0, 7 * (1 - intro), 4 * (1 - intro)));
      const cameraPosition = target.clone().add(offset);
      this.camera.position.lerp(cameraPosition, blend); this.cameraTarget.lerp(target, blend);
      const overviewSize = this.models.length < 8 ? 7 : (narrow ? 15 : 9.5);
      const desiredSize = THREE.MathUtils.lerp(overviewSize, this.mode === 'inspect' ? (narrow ? 8.7 : 6.4) : (narrow ? 10.5 : 6.6), detail);
      this.cameraSize = THREE.MathUtils.lerp(this.cameraSize, desiredSize, blend);
      this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, 1, blend);
      this.camera.lookAt(this.cameraTarget); this.projection();
      this.controls.target.copy(this.cameraTarget);
      if (this.mode === 'inspect' && detail > .998 && this.camera.position.distanceTo(cameraPosition) < .03 && Math.abs(this.camera.zoom - 1) < .005) {
        this.resetting = false; this.controls.enabled = !this.state?.overlay && !this.state?.reading; this.controls.update();
      }
    } else if (this.controls.enabled) this.controls.update();
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
    this.animation = requestAnimationFrame(this.render);
  };
  dispose() {
    if (this.disposed) return; this.disposed = true;
    cancelAnimationFrame(this.animation); this.observer.disconnect(); this.controls.dispose();
    this.cleanup.forEach(fn => fn());
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose()); geometries.forEach(geometry => geometry.dispose());
    this.environment.dispose(); this.keyLight.shadow.dispose();
    this.composer.passes.forEach(pass => pass.dispose());
    this.contactShading.gtaoMaterial.dispose(); this.contactShading.blendMaterial.dispose();
    this.composer.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
