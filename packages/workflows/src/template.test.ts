// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { evaluateExpression, renderDeep, renderString, TemplateError } from './template.js';

describe('shared template engine (TRD-12 §3)', () => {
  it('reads paths across namespaces', () => {
    const scope = {
      inputs: { mode: 'review', duration_s: 15 },
      steps: { boards: { outputs: [{ asset: 'a1' }] } },
    };
    expect(evaluateExpression('inputs.mode', scope)).toBe('review');
    expect(evaluateExpression('steps.boards.outputs[0].asset', scope)).toBe('a1');
  });

  it('evaluates literals, arrays and objects', () => {
    expect(evaluateExpression('[16, 9]', {})).toEqual([16, 9]);
    expect(evaluateExpression('true', {})).toBe(true);
    expect(evaluateExpression('null', {})).toBeNull();
  });

  it('evaluates arithmetic, comparison, logical, ternary and in', () => {
    const scope = { inputs: { mode: 'review', product: '' }, n: 3 };
    expect(evaluateExpression('inputs.mode == "review" && !inputs.product', scope)).toBe(true);
    expect(evaluateExpression('n <= 15 ? n : 15', scope)).toBe(3);
    expect(evaluateExpression('ceil(n / 2)', scope)).toBe(2);
    expect(evaluateExpression('"review" in ["review", "website"]', {})).toBe(true);
    expect(evaluateExpression('4 % 3', {})).toBe(1);
  });

  it('runs library functions and the pipe filter sugar', () => {
    const scope = { boards: [{ clean: 'c1' }, { clean: 'c2' }], claims: ['a', 'b'] };
    expect(evaluateExpression('range(1, 4)', {})).toEqual([1, 2, 3]);
    expect(evaluateExpression('boards | map("clean")', scope)).toEqual(['c1', 'c2']);
    expect(evaluateExpression("claims | join('; ') | default('no claims')", scope)).toBe('a; b');
    expect(evaluateExpression("[] | join('; ') | default('no claims')", scope)).toBe('no claims');
    expect(evaluateExpression('money(3.5)', {})).toBe('$3.50');
    expect(evaluateExpression('pad(3, 2)', {})).toBe('03');
    expect(evaluateExpression("slug('Three Quarter Left!')", {})).toBe('three-quarter-left');
  });

  it('view_phrases and intersect read as documented', () => {
    expect(evaluateExpression('view_phrases(["three_quarter_left", "back"])', {})).toEqual([
      'three-quarter left view',
      'back view',
    ]);
    expect(evaluateExpression('intersect(["a", "b", "c"], ["b", "c", "d"])', {})).toEqual(['b', 'c']);
  });

  it('keeps type for a whole-template string and concatenates otherwise', () => {
    const scope = { n: 5, list: [1, 2, 3] };
    expect(renderString('{{ n }}', scope)).toBe(5);
    expect(renderString('{{ list }}', scope)).toEqual([1, 2, 3]);
    expect(renderString('duration {{ n }} s', scope)).toBe('duration 5 s');
  });

  it('interpolates a string that both starts and ends with a template', () => {
    // A prompt scaffold that opens with one placeholder and closes with another
    // must be interpolated, not read as a single expression (regression: the
    // whole-template shortcut must not span two adjacent templates).
    const scope = { product: 'a bottle', extra: 'mint leaves' };
    expect(renderString('{{product}} on ice. {{extra}}', scope)).toBe('a bottle on ice. mint leaves');
    expect(renderString('{{product}} on ice.{{extra}}', { product: 'x', extra: '' })).toBe('x on ice.');
  });

  it('renders nested objects and arrays deeply', () => {
    const scope = { inputs: { duration_s: 15 }, vars: { creator: 'c1' } };
    const rendered = renderDeep(
      { params: { duration_s: '{{ inputs.duration_s }}' }, medias: ['{{ vars.creator }}'] },
      scope,
    );
    expect(rendered).toEqual({ params: { duration_s: 15 }, medias: ['c1'] });
  });

  it('refuses prototype access and unknown functions', () => {
    expect(() => evaluateExpression('inputs.__proto__', { inputs: {} })).toThrow(TemplateError);
    expect(() => evaluateExpression('inputs.constructor', { inputs: {} })).toThrow(TemplateError);
    expect(() => evaluateExpression('danger()', {})).toThrow(TemplateError);
  });
});
