import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Softens distant archive rows and the ground-level edge of each row. */
export class ArchiveDepthBlurPass extends ShaderPass {
  private readonly focusInView = new THREE.Vector3();

  constructor(depthTexture: THREE.DepthTexture) {
    super(new THREE.ShaderMaterial({
      name: 'ArchiveDepthBlur',
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: depthTexture },
        texel: { value: new THREE.Vector2(1, 1) },
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        focusDistance: { value: 0 },
        overview: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 texel;
        uniform mat4 inverseProjection;
        uniform mat4 cameraWorld;
        uniform float focusDistance;
        uniform float overview;
        varying vec2 vUv;

        void main() {
          vec4 center = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).x;
          if (depth >= 0.99999 || overview <= 0.001) {
            gl_FragColor = center;
            return;
          }

          vec4 view = inverseProjection * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          view /= view.w;
          float worldY = (cameraWorld * view).y;
          float distanceBehindFocus = max(0.0, -view.z - focusDistance);
          float distant = smoothstep(1.5, 17.0, distanceBehindFocus);
          float bottom = 1.0 - smoothstep(0.05, 0.92, worldY);
          float radius = max(distant * 9.0, bottom * 4.0) * overview;
          if (radius < 0.12) {
            gl_FragColor = center;
            return;
          }

          vec2 stepSize = texel * radius;
          vec4 blurred = center * 4.0;
          blurred += texture2D(tDiffuse, vUv + vec2(stepSize.x, 0.0));
          blurred += texture2D(tDiffuse, vUv - vec2(stepSize.x, 0.0));
          blurred += texture2D(tDiffuse, vUv + vec2(0.0, stepSize.y));
          blurred += texture2D(tDiffuse, vUv - vec2(0.0, stepSize.y));
          blurred += texture2D(tDiffuse, vUv + stepSize);
          blurred += texture2D(tDiffuse, vUv - stepSize);
          blurred += texture2D(tDiffuse, vUv + vec2(stepSize.x, -stepSize.y));
          blurred += texture2D(tDiffuse, vUv + vec2(-stepSize.x, stepSize.y));
          gl_FragColor = blurred / 12.0;
        }
      `,
      depthTest: false,
      depthWrite: false,
    }));
  }

  override setSize(width: number, height: number) {
    this.uniforms.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  update(camera: THREE.OrthographicCamera, focus: THREE.Vector3, overview: number) {
    camera.updateMatrixWorld();
    this.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    this.uniforms.focusDistance.value = -this.focusInView.copy(focus).applyMatrix4(camera.matrixWorldInverse).z;
    this.uniforms.overview.value = THREE.MathUtils.clamp(overview, 0, 1);
    this.enabled = overview > 0.005;
  }
}
