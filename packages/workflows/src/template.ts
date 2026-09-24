// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The shared templating and expression engine (TRD-12 §3). One engine renders
// the {{ }} templates for both Presets (PRD-09) and Workflows (PRD-10): the
// preset render path (packages/presets) delegates here so a preset and a
// workflow evaluate an expression identically, and a preset that launches a
// workflow carries the same value semantics across the boundary (M5 default
// revisited in M6).
//
// The expression language is a small, side-effect-free subset parsed with jsep:
// path access, literals, the arithmetic, comparison, logical, ternary and `in`
// operators, a fixed library of pure functions, and the `x | f(args)` filter
// sugar that desugars to `f(x, args)`. Security (TRD-12 §11): there is no
// property access to prototype chains (`__proto__`, `constructor`, `prototype`
// are refused), no assignment, no `new`, and only the functions in this file can
// be called — an identifier is never resolved to a JavaScript function.

import jsep from 'jsep';

// Register the pipe `|` as a low-precedence binary operator so `x | f(a)` parses
// as a binary expression we rewrite into a call. `in` is registered too.
jsep.addBinaryOp('|', 1);
jsep.addBinaryOp('in', 8);
// Remove operators the language does not allow so they cannot slip through.
jsep.removeBinaryOp('<<');
jsep.removeBinaryOp('>>');
jsep.removeBinaryOp('>>>');
jsep.removeBinaryOp('&');
jsep.removeBinaryOp('^');
jsep.removeUnaryOp('~');

// A minimal shape for the jsep AST nodes we handle, so we stay type-safe under
// the strict compiler without depending on jsep's loose Expression type.
interface Node {
  type: string;
  [key: string]: unknown;
}

/** The evaluation scope: the namespaces a template may read (TRD-12 §3). */
export type Scope = Record<string, unknown>;

/** Raised when an expression is malformed or does something disallowed. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Parsed expressions are cached; workflows re-render the same template on every
// checkpoint, so parsing once per unique string keeps the executor cheap.
const parseCache = new Map<string, Node>();

function parse(source: string): Node {
  const cached = parseCache.get(source);
  if (cached) return cached;
  let ast: Node;
  try {
    ast = jsep(source) as unknown as Node;
  } catch (error) {
    throw new TemplateError(
      `cannot parse expression "${source}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  parseCache.set(source, ast);
  return ast;
}

// ── the pure function library (TRD-12 §3) ──────────────────────────────────

type Fn = (...args: unknown[]) => unknown;

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) throw new TemplateError(`expected a number, got ${JSON.stringify(value)}`);
  return n;
}

function arr(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TemplateError(`expected an array, got ${JSON.stringify(value)}`);
  return value;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function slug(value: unknown): string {
  return str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Read a property key from an object or array, refusing prototype access.
function member(object: unknown, key: string | number): unknown {
  if (object === null || object === undefined) return undefined;
  if (typeof key === 'string' && BANNED_KEYS.has(key))
    throw new TemplateError(`property "${key}" is not allowed`);
  if (Array.isArray(object)) {
    if (typeof key === 'number') return object[key];
    if (key === 'length') return object.length;
    return undefined;
  }
  if (typeof object === 'string') {
    if (key === 'length') return object.length;
    if (typeof key === 'number') return object[key];
    return undefined;
  }
  if (typeof object === 'object') return (object as Record<string, unknown>)[String(key)];
  return undefined;
}

const FUNCTIONS: Record<string, Fn> = {
  range: (a, b) => {
    const start = num(a);
    const end = b === undefined ? start : num(b);
    const from = b === undefined ? 0 : start;
    const out: number[] = [];
    for (let i = from; i < end; i += 1) out.push(i);
    return out;
  },
  ceil: (x) => Math.ceil(num(x)),
  floor: (x) => Math.floor(num(x)),
  round: (x, digits) => {
    const d = digits === undefined ? 0 : num(digits);
    const factor = 10 ** d;
    return Math.round(num(x) * factor) / factor;
  },
  min: (...xs) => Math.min(...xs.map(num)),
  max: (...xs) => Math.max(...xs.map(num)),
  abs: (x) => Math.abs(num(x)),
  len: (x) => (Array.isArray(x) ? x.length : str(x).length),
  join: (a, sep) =>
    arr(a)
      .map(str)
      .join(sep === undefined ? '' : str(sep)),
  slice: (a, start, end) =>
    Array.isArray(a)
      ? a.slice(num(start), end === undefined ? undefined : num(end))
      : str(a).slice(num(start), end === undefined ? undefined : num(end)),
  take: (a, n) => arr(a).slice(0, num(n)),
  first: (a) => (Array.isArray(a) ? a[0] : undefined),
  last: (a) => {
    const list = arr(a);
    return list[list.length - 1];
  },
  concat: (a, b) => {
    if (Array.isArray(a) || Array.isArray(b)) {
      return [
        ...(Array.isArray(a) ? a : a === undefined || a === null ? [] : [a]),
        ...(Array.isArray(b) ? b : b === undefined || b === null ? [] : [b]),
      ];
    }
    return str(a) + str(b);
  },
  flatten: (a) => arr(a).flat(),
  default: (x, fallback) => (x === undefined || x === null || x === '' ? fallback : x),
  json: (x) => JSON.stringify(x),
  upper: (s) => str(s).toUpperCase(),
  lower: (s) => str(s).toLowerCase(),
  trim: (s) => str(s).trim(),
  slug,
  replace: (s, from, to) => str(s).split(str(from)).join(str(to)),
  format: (fmt, ...rest) => {
    let index = 0;
    return str(fmt).replace(/\{\}/g, () => {
      const value = rest[index];
      index += 1;
      return str(value);
    });
  },
  pick: (object, keys) => {
    const out: Record<string, unknown> = {};
    for (const key of arr(keys)) out[str(key)] = member(object, str(key));
    return out;
  },
  zip: (a, b) => {
    const left = arr(a);
    const right = arr(b);
    const out: unknown[][] = [];
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) out.push([left[i], right[i]]);
    return out;
  },
  sum: (a) => arr(a).reduce<number>((total, value) => total + num(value), 0),
  pad: (n, width) => str(n).padStart(num(width), '0'),
  money: (usd) => `$${num(usd).toFixed(2)}`,
  secs_to_clock: (s) => {
    const total = Math.round(num(s));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  },
  split: (s, sep) => str(s).split(str(sep)),
  intersect: (a, b) => {
    const other = new Set(arr(b).map(str));
    return arr(a).filter((value) => other.has(str(value)));
  },
  render: (template, vars) => renderString(str(template), (vars ?? {}) as Scope),
  // Collection helpers
  filter: (a, key, value) => arr(a).filter((item) => member(item, str(key)) === value),
  map: (a, key) => arr(a).map((item) => member(item, str(key))),
  map_index: (a, fmt, stepS) => {
    const step = stepS === undefined ? 1 : num(stepS);
    return arr(a).map((shot, i) =>
      str(fmt)
        .replace(/\{i\}/g, String(i + 1))
        .replace(/\{t0\}/g, String(Math.round(i * step * 10) / 10))
        .replace(/\{t1\}/g, String(Math.round((i + 1) * step * 10) / 10))
        .replace(/\{shot\}/g, str(shot)),
    );
  },
  sort_by_kind: (a, order) => {
    const rank = new Map(arr(order).map((kind, i) => [str(kind), i] as const));
    return [...arr(a)].sort(
      (left, right) =>
        (rank.get(str(member(left, 'kind'))) ?? 99) - (rank.get(str(member(right, 'kind'))) ?? 99),
    );
  },
  some: (a, value) => arr(a).some((item) => item === value),
  count: (a, value) => arr(a).filter((item) => item === value).length,
  find_prefix: (a, prefix) => {
    const p = str(prefix);
    for (const value of arr(a)) {
      const s = str(value);
      if (s.startsWith(p)) return s.slice(p.length);
    }
    return undefined;
  },
  map_role: (refs, role) =>
    arr(refs)
      .filter((ref) => ref !== null && ref !== undefined && ref !== '')
      .map((ref) => ({ role: str(role), ref })),
  view_phrases: (views) =>
    arr(views).map(
      (view) => `${str(view).replace(/_/g, ' ').replace('three quarter', 'three-quarter')} view`,
    ),
};

// ── the evaluator ───────────────────────────────────────────────────────────

function evaluate(node: Node, scope: Scope): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier': {
      const name = node.name as string;
      if (BANNED_KEYS.has(name)) throw new TemplateError(`identifier "${name}" is not allowed`);
      return scope[name];
    }
    case 'MemberExpression': {
      const object = evaluate(node.object as Node, scope);
      const propertyNode = node.property as Node;
      const key = node.computed
        ? (evaluate(propertyNode, scope) as string | number)
        : (propertyNode.name as string);
      return member(object, key);
    }
    case 'ArrayExpression':
      return (node.elements as Node[]).map((element) => evaluate(element, scope));
    case 'UnaryExpression': {
      const value = evaluate(node.argument as Node, scope);
      if (node.operator === '!') return !truthy(value);
      if (node.operator === '-') return -num(value);
      if (node.operator === '+') return num(value);
      throw new TemplateError(`unary operator "${String(node.operator)}" is not allowed`);
    }
    case 'BinaryExpression':
    case 'LogicalExpression':
      return binary(node, scope);
    case 'ConditionalExpression':
      return truthy(evaluate(node.test as Node, scope))
        ? evaluate(node.consequent as Node, scope)
        : evaluate(node.alternate as Node, scope);
    case 'CallExpression':
      return call(node, scope);
    case 'Compound':
      throw new TemplateError('an expression may contain only one statement');
    default:
      throw new TemplateError(`unsupported expression node "${node.type}"`);
  }
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function binary(node: Node, scope: Scope): unknown {
  const operator = node.operator as string;
  // The pipe desugars `x | f(args)` into `f(x, args)`.
  if (operator === '|') return pipe(node, scope);
  // Logical operators short-circuit.
  if (operator === '&&') {
    const left = evaluate(node.left as Node, scope);
    return truthy(left) ? evaluate(node.right as Node, scope) : left;
  }
  if (operator === '||') {
    const left = evaluate(node.left as Node, scope);
    return truthy(left) ? left : evaluate(node.right as Node, scope);
  }
  const left = evaluate(node.left as Node, scope);
  const right = evaluate(node.right as Node, scope);
  switch (operator) {
    case '+':
      return typeof left === 'string' || typeof right === 'string'
        ? str(left) + str(right)
        : num(left) + num(right);
    case '-':
      return num(left) - num(right);
    case '*':
      return num(left) * num(right);
    case '/':
      return num(left) / num(right);
    case '%':
      return num(left) % num(right);
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return num(left) < num(right);
    case '<=':
      return num(left) <= num(right);
    case '>':
      return num(left) > num(right);
    case '>=':
      return num(left) >= num(right);
    case 'in':
      if (Array.isArray(right)) return right.includes(left);
      if (right && typeof right === 'object') return str(left) in (right as Record<string, unknown>);
      return false;
    default:
      throw new TemplateError(`operator "${operator}" is not allowed`);
  }
}

// `x | f(a, b)` becomes `f(x, a, b)`; `x | f` becomes `f(x)`.
function pipe(node: Node, scope: Scope): unknown {
  const input = evaluate(node.left as Node, scope);
  const right = node.right as Node;
  if (right.type === 'CallExpression') {
    const callee = right.callee as Node;
    const name = callee.name as string;
    const fn = FUNCTIONS[name];
    if (!fn) throw new TemplateError(`unknown function "${name}"`);
    const args = (right.arguments as Node[]).map((argument) => evaluate(argument, scope));
    return fn(input, ...args);
  }
  if (right.type === 'Identifier') {
    const name = right.name as string;
    const fn = FUNCTIONS[name];
    if (!fn) throw new TemplateError(`unknown function "${name}"`);
    return fn(input);
  }
  throw new TemplateError('the right side of a pipe must be a function');
}

function call(node: Node, scope: Scope): unknown {
  const callee = node.callee as Node;
  if (callee.type !== 'Identifier')
    throw new TemplateError('only named functions from the library may be called');
  const name = callee.name as string;
  const fn = FUNCTIONS[name];
  if (!fn) throw new TemplateError(`unknown function "${name}"`);
  const args = (node.arguments as Node[]).map((argument) => evaluate(argument, scope));
  return fn(...args);
}

/** Evaluate a single expression (the text between {{ and }}) against a scope. */
export function evaluateExpression(source: string, scope: Scope): unknown {
  return evaluate(parse(source.trim()), scope);
}

const TEMPLATE = /\{\{([\s\S]*?)\}\}/g;

/**
 * Render a string that may contain {{ }} templates. A string that is exactly one
 * template keeps the expression's own type (an array, number or boolean stays
 * that type); otherwise every template is stringified and concatenated with the
 * surrounding text (TRD-12 §3).
 */
export function renderString(input: string, scope: Scope): unknown {
  const whole = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(input);
  // The whole-template branch keeps the expression's type, but only when the
  // string is a single template: a captured body that itself contains `{{` means
  // the string opened one template and closed a different one (e.g. a prompt that
  // starts with `{{a}}` and ends with `{{b}}`), which must be interpolated, not
  // evaluated as one expression.
  if (whole && whole[1] !== undefined && !whole[1].includes('{{')) {
    return evaluateExpression(whole[1], scope);
  }
  return input.replace(TEMPLATE, (_all, expr: string) => {
    const value = evaluateExpression(expr, scope);
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/**
 * Recursively render every string in a value. Objects and arrays are walked;
 * a string is rendered (keeping its type when it is a whole template); other
 * scalars pass through. This is what the planner and executor use to resolve a
 * step's rendered fields.
 */
export function renderDeep(value: unknown, scope: Scope): unknown {
  if (typeof value === 'string') return renderString(value, scope);
  if (Array.isArray(value)) return value.map((item) => renderDeep(item, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderDeep(child, scope);
    }
    return out;
  }
  return value;
}

/** The names of the functions the engine exposes, for the validator (§7). */
export const FUNCTION_NAMES: readonly string[] = Object.freeze(Object.keys(FUNCTIONS));
