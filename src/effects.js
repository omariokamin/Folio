/*
 * effects.js — named effect presets shared by the inspector buttons and Claude's tools,
 * so a "Lagoon" mesh or "Liquid glass" means exactly the same thing in both places.
 *   Folio.effects.meshPresets          [{ name, base, spread?, points: [4 colours] }]
 *   Folio.effects.mesh(name, current?)  → a mesh fill (keeps the current fill's point positions/visibility)
 *   Folio.effects.glass(kind)           → style patch for 'liquid-glass' | 'dark-glass' (no radius), or null
 */
window.Folio = window.Folio || {};

(function () {
  const MESH_POS = [
    { x: 12, y: 18 },
    { x: 88, y: 12 },
    { x: 82, y: 88 },
    { x: 18, y: 82 },
  ];
  // the shader-style five (Aurora..Chrome) carry their own spread and pair with a noise fill at 0.08-0.15
  const meshPresets = [
    { name: 'Nebula', base: '#0b1026', points: ['#6d5efc', '#22d3ee', '#a855f7', '#10b981'] },
    { name: 'Peach', base: '#ffe8dc', points: ['#ff8a65', '#ffd166', '#f472b6', '#fdba74'] },
    { name: 'Mint', base: '#e6fbf7', points: ['#14b8a6', '#60a5fa', '#a7f3d0', '#3b82f6'] },
    { name: 'Sunset', base: '#2a0a3d', points: ['#ff6b6b', '#f59e0b', '#ec4899', '#8b5cf6'] },
    { name: 'Pastel', base: '#fdf4ff', points: ['#c4b5fd', '#fde68a', '#93c5fd', '#f9a8d4'] },
    { name: 'Aurora', base: '#03111a', spread: 52, points: ['#1ee3a1', '#0b6f7a', '#8cf5c9', '#c2418a'] },
    { name: 'Dusk', base: '#2a2033', spread: 62, points: ['#ff9b5e', '#e0557b', '#ffd08a', '#3f5a86'] },
    { name: 'Lagoon', base: '#dff5ee', spread: 60, points: ['#00a3a0', '#7fdcc6', '#f3e4b0', '#1f6fae'] },
    { name: 'Ember', base: '#170705', spread: 52, points: ['#ff5b1f', '#ffb12e', '#a3121d', '#ff8a4c'] },
    { name: 'Chrome', base: '#c9ced5', spread: 56, points: ['#fbfcfd', '#7d8590', '#eef1f4', '#4f5660'] },
  ];

  function mesh(preset, f) {
    const pr = typeof preset === 'string' ? meshPresets.find((p) => p.name.toLowerCase() === preset.trim().toLowerCase()) : preset;
    if (!pr) return null;
    const pos = (i) => (f && f.points && f.points[i] ? f.points[i] : MESH_POS[i]);
    return {
      type: 'mesh',
      base: pr.base,
      spread: pr.spread || (f && f.spread) || 60,
      points: pr.points.map((c, i) => ({ color: c, x: pos(i).x, y: pos(i).y })),
      visible: f ? f.visible !== false : true,
    };
  }

  const GLASS_TINTS = { 'liquid-glass': ['#ffffff47', '#ffffff14'], 'dark-glass': ['#ffffff1f', '#ffffff0a'] };
  function glass(kind) {
    const tint = GLASS_TINTS[kind];
    if (!tint) return null;
    const inset = (y, color) => ({ x: 0, y, blur: 0, spread: 0, color, inset: true, visible: true });
    return {
      fills: [{ type: 'linear', angle: 160, stops: [{ color: tint[0], pos: 0 }, { color: tint[1], pos: 100 }], visible: true }],
      backdropBlur: 24,
      backdropSaturate: 180,
      border: { width: 1, color: '#ffffff59', style: 'solid' },
      shadows: [inset(1, '#ffffff80'), inset(-1, '#ffffff1a'), { x: 0, y: 8, blur: 32, spread: -8, color: '#0f172a2e', inset: false, visible: true }],
    };
  }

  Folio.effects = { meshPresets, meshPos: MESH_POS, mesh, glass, glassKinds: Object.keys(GLASS_TINTS) };
})();
