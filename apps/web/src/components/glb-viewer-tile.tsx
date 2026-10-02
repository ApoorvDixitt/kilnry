'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// GLBViewerTile (F-CRE-15, PRD-05 §15): draws a GLB from the Library with orbit
// and zoom, a wireframe toggle and an auto-rotate toggle that starts off under
// reduced motion. three.js is loaded only when a 3D tile is on screen, so no
// other page pays for it. Without WebGL, or if the model cannot be drawn, the
// tile offers "Open in your 3D app" instead.

import { useEffect, useRef, useState } from 'react';
import { message } from '../lib/messages';
import { autoRotateDefault, framingDistance, supportsWebGL } from './glb-viewer-logic';

type ViewerState = 'loading' | 'webgl' | 'fallback' | 'failed';

interface ViewerHandle {
  setWireframe: (on: boolean) => void;
  setAutoRotate: (on: boolean) => void;
  dispose: () => void;
}

export function GlbViewerTile({ assetId }: { assetId: string }): React.ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerHandle | null>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const [failure, setFailure] = useState<string>();
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(() =>
    typeof window === 'undefined'
      ? false
      : autoRotateDefault(window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  const src = `/api/media/${encodeURIComponent(assetId)}`;
  // The latest auto-rotate choice, read when the viewer finishes loading.
  const autoRotateRef = useRef(autoRotate);

  useEffect(() => {
    if (!supportsWebGL(document)) {
      setState('fallback');
      return;
    }
    let disposed = false;
    void (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const element = host.current;
      if (disposed || !element) return;
      const width = element.clientWidth || 220;
      const height = element.clientHeight || 220;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      element.append(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(3, 5, 4);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000);
      const gltf = await new GLTFLoader().loadAsync(src);
      if (disposed) {
        renderer.dispose();
        return;
      }
      const model = gltf.scene;
      // A mesh without its own material (a bare triangle fixture, for one)
      // gets a neutral one so it is visible and the wireframe toggle applies.
      model.traverse((node) => {
        const mesh = node as import('three').Mesh;
        if (mesh.isMesh && !mesh.material) {
          mesh.material = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, side: THREE.DoubleSide });
        }
      });
      scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const distance = framingDistance(sphere.radius, camera.fov);
      camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + distance);
      camera.near = distance / 100;
      camera.far = distance * 100;
      camera.updateProjectionMatrix();
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(sphere.center);
      controls.enableZoom = true;
      controls.enableDamping = true;
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
      viewer.current = {
        setWireframe: (on) =>
          model.traverse((node) => {
            const mesh = node as import('three').Mesh;
            if (!mesh.isMesh) return;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              if (material && 'wireframe' in material) (material as { wireframe: boolean }).wireframe = on;
            }
          }),
        setAutoRotate: (on) => {
          controls.autoRotate = on;
        },
        dispose: () => {
          renderer.setAnimationLoop(null);
          controls.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        },
      };
      setState('webgl');
    })().catch((error: unknown) => {
      if (disposed) return;
      setFailure(error instanceof Error ? error.message : String(error));
      setState('failed');
    });
    return () => {
      disposed = true;
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, [src]);

  // The latest auto-rotate choice is pushed to the live controls.
  useEffect(() => {
    autoRotateRef.current = autoRotate;
    viewer.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);
  useEffect(() => {
    viewer.current?.setWireframe(wireframe);
  }, [wireframe]);

  const drawable = state === 'loading' || state === 'webgl';
  return (
    <div
      className="glb-viewer"
      role="group"
      aria-label={message('create.glb.label')}
      data-viewer={state}
      data-auto-rotate={String(autoRotate)}
      data-wireframe={String(wireframe)}
    >
      {drawable ? <div ref={host} className="glb-viewer-canvas" /> : null}
      {state === 'loading' ? (
        <span className="glb-viewer-status">{message('create.glb.loading')}</span>
      ) : null}
      {state === 'webgl' ? (
        <div className="glb-viewer-toolbar">
          <button
            type="button"
            className="glb-viewer-toggle"
            aria-pressed={wireframe}
            onClick={() => setWireframe((on) => !on)}
          >
            {message('create.glb.wireframe')}
          </button>
          <button
            type="button"
            className="glb-viewer-toggle"
            aria-pressed={autoRotate}
            onClick={() => setAutoRotate((on) => !on)}
          >
            {message('create.glb.autoRotate')}
          </button>
        </div>
      ) : null}
      {!drawable ? (
        <div className="glb-viewer-fallback">
          <span className="glb-viewer-glyph" aria-hidden="true">
            3D
          </span>
          {state === 'failed' ? (
            <p className="glb-viewer-status" role="status" title={failure}>
              {message('create.glb.failed')}
            </p>
          ) : null}
          <a className="glb-viewer-open" href={src} download>
            {message('create.glb.openIn3dApp')}
          </a>
        </div>
      ) : null}
    </div>
  );
}
