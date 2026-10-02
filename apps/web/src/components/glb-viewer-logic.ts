// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the GLB viewer tile (F-CRE-15, PRD-05 §15),
// unit-tested without WebGL.

// Whether this browser can draw the model. Without WebGL the tile shows a
// static placeholder and "Open in your 3D app" instead (PRD-05 §15 States).
export function supportsWebGL(doc: Pick<Document, 'createElement'>): boolean {
  try {
    const canvas = doc.createElement('canvas') as HTMLCanvasElement;
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    // A browser that throws on context creation cannot render the model; the
    // tile falls back rather than failing.
    return false;
  }
}

// Auto-rotate starts on unless the user asked for reduced motion, in which case
// it starts off and stays a manual toggle (PRD-05 §15 acceptance 2).
export function autoRotateDefault(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

// The camera distance that frames a model of the given bounding radius in a
// vertical field of view, with a little margin so it never touches the edges.
export function framingDistance(radius: number, fovDegrees: number): number {
  const safeRadius = radius > 0 && Number.isFinite(radius) ? radius : 1;
  const half = (fovDegrees * Math.PI) / 360;
  return (safeRadius / Math.sin(half)) * 1.15;
}
