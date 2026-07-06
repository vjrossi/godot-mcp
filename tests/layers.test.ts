/**
 * Regression tests for manage_layers (project.godot layer-name handling).
 *
 * These lock in two bugs found and fixed after empirical testing against a live
 * Godot 4.6 instance:
 *   1. Wrong category token — the tool wrote "physics_2d" where Godot uses "2d_physics".
 *   2. Doubled section prefix — it wrote `layer_names/physics_2d/layer_1="..."` as a line
 *      *under* the [layer_names] section, so Godot read it as a setting literally named
 *      "layer_names/layer_names/physics_2d/layer_1" and never populated the real slot.
 *
 * The corrected format `2d_physics/layer_1="world"` under [layer_names] was confirmed to
 * read back via ProjectSettings.get_setting("layer_names/2d_physics/layer_1") === "world".
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalizeLayerType,
  listLayerNames,
  setLayerNameInProjectGodot,
} from '../src/utils.js';

const EMPTY_PROJECT = `config_version=5

[application]

config/name="test"
`;

describe('canonicalizeLayerType', () => {
  it('maps the friendly aliases onto Godot 4 canonical tokens', () => {
    expect(canonicalizeLayerType('physics_2d')).toBe('2d_physics');
    expect(canonicalizeLayerType('physics_3d')).toBe('3d_physics');
    expect(canonicalizeLayerType('render')).toBe('2d_render');
    expect(canonicalizeLayerType('navigation')).toBe('2d_navigation');
  });

  it('passes canonical tokens through unchanged', () => {
    for (const t of ['2d_render', '3d_render', '2d_physics', '3d_physics', '2d_navigation', '3d_navigation', 'avoidance']) {
      expect(canonicalizeLayerType(t)).toBe(t);
    }
  });

  it('is case-insensitive and rejects unknown types', () => {
    expect(canonicalizeLayerType('2D_PHYSICS')).toBe('2d_physics');
    expect(canonicalizeLayerType('bogus')).toBeNull();
  });
});

describe('setLayerNameInProjectGodot', () => {
  it('writes the canonical token, never the friendly alias', () => {
    const { content, line } = setLayerNameInProjectGodot(EMPTY_PROJECT, 'physics_2d', 1, 'world');
    expect(line).toBe('2d_physics/layer_1="world"');
    expect(content).toContain('2d_physics/layer_1="world"');
    expect(content).not.toContain('physics_2d/layer_1');
  });

  it('does NOT double the layer_names/ prefix (the section is not part of the key)', () => {
    const { content, line } = setLayerNameInProjectGodot(EMPTY_PROJECT, '2d_physics', 3, 'ground');
    // The written key line must be section-relative — no "layer_names/" on the data line.
    expect(line.startsWith('layer_names/')).toBe(false);
    expect(content).not.toContain('layer_names/2d_physics');
    // But it must live under the [layer_names] section.
    expect(content).toContain('[layer_names]');
    const section = content.slice(content.indexOf('[layer_names]'));
    expect(section).toContain('2d_physics/layer_3="ground"');
  });

  it('creates the [layer_names] section when absent', () => {
    expect(EMPTY_PROJECT).not.toContain('[layer_names]');
    const { content } = setLayerNameInProjectGodot(EMPTY_PROJECT, '2d_physics', 1, 'world');
    expect(content).toContain('[layer_names]');
  });

  it('replaces an existing entry for the same slot instead of duplicating it', () => {
    const once = setLayerNameInProjectGodot(EMPTY_PROJECT, '2d_physics', 1, 'world').content;
    const twice = setLayerNameInProjectGodot(once, '2d_physics', 1, 'renamed').content;
    expect(twice).toContain('2d_physics/layer_1="renamed"');
    expect(twice).not.toContain('2d_physics/layer_1="world"');
    expect(twice.match(/2d_physics\/layer_1=/g)?.length).toBe(1);
  });

  it('throws a helpful error on an unrecognised layerType', () => {
    expect(() => setLayerNameInProjectGodot(EMPTY_PROJECT, 'nonsense', 1, 'x')).toThrow(/Invalid layerType/);
  });
});

describe('listLayerNames', () => {
  it('round-trips with setLayerNameInProjectGodot', () => {
    let c = EMPTY_PROJECT;
    c = setLayerNameInProjectGodot(c, '2d_physics', 1, 'world').content;
    c = setLayerNameInProjectGodot(c, '3d_render', 2, 'props').content;
    const layers = listLayerNames(c);
    expect(layers).toEqual(
      expect.arrayContaining([
        { type: '2d_physics', layer: 1, name: 'world' },
        { type: '3d_render', layer: 2, name: 'props' },
      ]),
    );
    expect(layers).toHaveLength(2);
  });

  it('does NOT read the old malformed format as a valid layer (regression guard)', () => {
    const malformed = `${EMPTY_PROJECT}
[layer_names]
layer_names/physics_2d/layer_1="world"
`;
    // The buggy line must not be mistaken for a real layer entry.
    expect(listLayerNames(malformed)).toHaveLength(0);
  });
});
