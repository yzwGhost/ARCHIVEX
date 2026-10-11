import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ArchiveEntry } from '../types.ts';
import { fileCode } from '../archive-state.ts';

export const BINDER_WIDTH = 3.72;
export const BINDER_HEIGHT = 2.72;

export function createModelAssets() {
  return {
    cover: new RoundedBoxGeometry(BINDER_WIDTH, BINDER_HEIGHT, .075, 3, .032),
    pages: new THREE.BoxGeometry(3.60, 2.60, .11),
    strip: new THREE.BoxGeometry(.055, 2.62, .055),
    fastener: new THREE.CylinderGeometry(.026, .026, .02, 8),
    ivory: new THREE.MeshStandardMaterial({ color: '#eee8dc', roughness: .64, envMapIntensity: .45 }),
    paper: new THREE.MeshStandardMaterial({ color: '#e0d9cb', roughness: .96, envMapIntensity: .25 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d8c590', roughness: .65, metalness: .22 }),
    metal: new THREE.MeshStandardMaterial({ color: '#a6aaa4', roughness: .52, metalness: .48 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#fffaf0', transparent: true, opacity: .15, roughness: .30, metalness: 0, clearcoat: .35, clearcoatRoughness: .36, envMapIntensity: .8, depthWrite: false, side: THREE.DoubleSide }),
    ring: new THREE.MeshStandardMaterial({ color: '#e0d5c1', roughness: .62, metalness: .06, envMapIntensity: .55 }),
  };
}
type Assets = ReturnType<typeof createModelAssets>;

export class ArchiveModel {
  readonly group = new THREE.Group();
  readonly detail = new THREE.Group();
  private layers: { object: THREE.Object3D; z: number; spread: number }[] = [];
  private strip: THREE.Mesh;
  private goldMaterial: THREE.MeshStandardMaterial;
  constructor(entry: ArchiveEntry, index: number, assets: Assets) {
    this.group.rotation.y = Math.PI / 2;
    this.group.userData.entryIndex = index;
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, z: number, spread: number, parent: THREE.Group = this.group) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(0, BINDER_HEIGHT / 2, z);
      object.castShadow = parent === this.group;
      // VSM renders shadow receivers too; transparent overlays must stay out.
      object.receiveShadow = !material.transparent;
      parent.add(object); this.layers.push({ object, z, spread }); return object;
    };
    add(assets.cover, assets.ivory, -.115, -1.15);
    add(assets.pages, assets.paper, -.035, -.40);
    add(assets.cover, assets.ivory, .065, .10);
    this.goldMaterial = assets.gold.clone();
    this.strip = add(assets.strip, this.goldMaterial, .12, .62);
    this.strip.position.x = -1.65;

    const fasteners = new THREE.Group();
    for (const x of [-1.73, 1.73]) for (const y of [.12, 2.60]) {
      const screw = new THREE.Mesh(assets.fastener, assets.metal);
      screw.rotation.x = Math.PI / 2; screw.position.set(x, y, .128); fasteners.add(screw);
    }
    this.group.add(fasteners); this.layers.push({ object: fasteners, z: 0, spread: .95 });
    this.group.add(this.detail);
    const panel = add(assets.cover, assets.glass, .18, 1.2, this.detail);
    panel.renderOrder = 2;
    const rings = new THREE.Group();
    for (const [x, y, radius] of [[-.12, 1.52, .62], [1.0, 1.96, .28]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .047, 8, 64), assets.ring);
      ring.position.set(x, y, .20); rings.add(ring);
      const inset = new THREE.Mesh(new THREE.TorusGeometry(radius - .075, .012, 6, 64), assets.glass);
      inset.position.set(x, y, .21); rings.add(inset);
    }
    this.detail.add(rings); this.layers.push({ object: rings, z: 0, spread: .65 });

    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, 1024, 768);
    context.fillStyle = '#242823';
    context.font = 'bold 23px Arial'; context.fillText('RHINE LAB, LLC.', 95, 62);
    context.font = '11px Arial'; context.fillText('INFORMATION  /  ARCHIVE SYSTEM', 95, 87);
    context.font = 'bold 32px Arial'; context.fillText(`NO.${String(index + 1).padStart(3, '0')}`, 95, 133);
    context.font = 'bold 38px Arial'; context.fillText('∞', 308, 128);
    context.font = '12px Arial'; context.fillText(fileCode(index), 80, 675);
    context.font = '14px "Microsoft YaHei", sans-serif'; context.fillText(entry.title.slice(0, 42), 80, 704);
    context.fillStyle = '#66685f'; context.fillRect(808, 682, 90, 3);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const label = add(new THREE.PlaneGeometry(3.58, 2.60), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }), .23, 1.25, this.detail);
    label.renderOrder = 3;
    this.detail.visible = false;
  }
  update(explode: number, selected: boolean, detailVisible: boolean) {
    this.detail.visible = detailVisible;
    this.strip.visible = selected || detailVisible;
    for (const layer of this.layers) layer.object.position.z = layer.z + layer.spread * explode;
  }
}
