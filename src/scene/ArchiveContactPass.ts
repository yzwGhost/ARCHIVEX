import { Mesh, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const CONTACT_LAYER = 2;

/** Transparent glass and label pixels must not become opaque AO surfaces. */
export class ArchiveContactPass extends GTAOPass {
  prepareOpaqueMeshes() {
    this.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.every(material => !material.transparent)) object.layers.enable(CONTACT_LAYER);
      else object.layers.disable(CONTACT_LAYER);
    });
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    const previousMask = this.camera.layers.mask;
    this.camera.layers.set(CONTACT_LAYER);
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      this.camera.layers.mask = previousMask;
    }
  }
}
