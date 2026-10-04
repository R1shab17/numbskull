// Map definitions. Every collider is an axis-aligned box resting on the ground or on
// another box, so the world is a solid height-field. That keeps movement,
// line-of-sight and bot navigation simple and fast.
//
// box: { x, z, w, d, h, y0, color, kind }  x/z = centre, w along X, d along Z,
//      spans y0 .. y0 + h.
// Maps are mirrored across X = 0 so Red (west) and Blue (east) sides are identical.

function B(x, z, w, d, h, color, kind = 'block', y0 = 0) {
  return { x, z, w, d, h, y0, color, kind };
}

// Steps leading down from a platform edge. (x, z) is the point on the edge where the
// flight attaches, `dir` is the direction you walk to go DOWN. Each step drops 0.5 m.
function flight(x, z, dir, width, topH, color, kind = 'block', run = 1, baseH = 0) {
  const out = [];
  for (let k = 1; ; k++) {
    const h = topH - 0.5 * k;
    if (h <= baseH + 0.05) break;
    const off = (k - 0.5) * run;
    const ax = dir === '+x' ? 1 : dir === '-x' ? -1 : 0;
    const az = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    const bx = x + ax * off, bz = z + az * off;
    const bw = ax ? run : width, bd = az ? run : width;
    out.push(B(bx, bz, bw, bd, h, color, kind));
  }
  return out;
}

function mirror(list) {
  const out = [];
  for (const b of list) {
    out.push(b);
    if (Math.abs(b.x) > 0.01) out.push({ ...b, x: -b.x });
  }
  return out;
}
function mirrorPts(list) {
  const out = [];
  for (const p of list) { out.push(p); if (Math.abs(p[0]) > 0.01) out.push([-p[0], p[1]]); }
  return out;
}
function perimeter(W, D, h, color) {
  const t = 1.2;
  return [
    B(0, -D / 2 - t / 2, W + 2 * t, t, h, color),
    B(0, D / 2 + t / 2, W + 2 * t, t, h, color),
    B(-W / 2 - t / 2, 0, t, D, h, color),
    B(W / 2 + t / 2, 0, t, D, h, color),
  ];
}

// ---------------------------------------------------------------- Sticky Plaza
function stickyPlaza() {
  const W = 100, D = 80;
  const C = { wall: '#f6b8c8', mint: '#8fe0c0', peach: '#ffbf94', lilac: '#bfaeff', sky: '#93ccff', butter: '#ffe27a', stone: '#ebe3d6', crate: '#d99a5b', hedge: '#59b35b', red: '#ff7482', plinth: '#d8cfc2' };
  const boxes = [];

  // centre plaza with a step on every side and a statue
  boxes.push(B(0, 0, 14, 14, 1.0, C.stone));
  boxes.push(...flight(0, 7, '+z', 4, 1.0, C.stone), ...flight(0, -7, '-z', 4, 1.0, C.stone));
  boxes.push(...flight(7, 0, '+x', 4, 1.0, C.stone), ...flight(-7, 0, '-x', 4, 1.0, C.stone));
  boxes.push(B(0, 0, 2.2, 2.2, 1.2, C.plinth, 'block', 1.0));
  for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) boxes.push(B(x, z, 2, 2, 0.95, C.hedge, 'hedge', 1.0));
  boxes.push(B(0, 16, 12, 0.8, 1.15, C.butter), B(0, -16, 12, 0.8, 1.15, C.butter));
  boxes.push(B(0, 29, 3, 3, 1.1, C.crate, 'crate'), B(0, -29, 3, 3, 1.1, C.crate, 'crate'));

  const half = [];
  // base bunkers and a shield wall in front of the flag
  half.push(B(-37, 8.5, 6, 0.8, 2.6, C.red), B(-37, -8.5, 6, 0.8, 2.6, C.red));
  half.push(B(-34.4, 10.4, 0.8, 4.6, 2.6, C.red), B(-34.4, -10.4, 0.8, 4.6, 2.6, C.red));
  half.push(B(-31, 0, 1, 7, 3.0, C.wall));
  // lookout towers
  for (const s of [1, -1]) {
    half.push(B(-42, 18 * s, 5, 5, 2.5, C.lilac));
    half.push(...flight(-39.5, 18 * s, '+x', 3, 2.5, C.lilac));
  }
  // houses with rooftop stairs
  half.push(B(-22, 20, 9, 9, 3.0, C.peach), ...flight(-20, 24.5, '+z', 2.4, 3.0, C.peach));
  half.push(B(-22, -20, 9, 9, 3.0, C.sky), ...flight(-20, -24.5, '-z', 2.4, 3.0, C.sky));
  // lane walls
  half.push(B(-26, 6, 1, 6, 3.0, C.wall), B(-26, -6, 1, 6, 3.0, C.wall));
  half.push(B(-12, 22, 1, 8, 3.0, C.mint), B(-12, -22, 1, 8, 3.0, C.mint));
  // low (crouch) cover
  half.push(B(-16, 8, 4, 0.8, 1.15, C.butter), B(-16, -8, 4, 0.8, 1.15, C.butter));
  half.push(B(-30, 30, 6, 0.8, 1.15, C.butter), B(-30, -30, 6, 0.8, 1.15, C.butter));
  half.push(B(-44, 28, 0.8, 6, 1.15, C.butter), B(-44, -28, 0.8, 6, 1.15, C.butter));
  // crates
  for (const [x, z, s, h] of [[-14, 0, 2, 1.0], [-12.6, 2.2, 1.2, 1.0], [-20, 9, 2, 2.0], [-20, -9, 2, 2.0], [-33, 24, 2, 1.0], [-33, -24, 2, 1.0],
    [-6, 24, 1.6, 1.0], [-6, -24, 1.6, 1.0], [-28, 14, 1.6, 1.0], [-28, -14, 1.6, 1.0], [-8, 34, 2, 1.0], [-8, -34, 2, 1.0], [-45.5, 3, 1.6, 1.0], [-45.5, -3, 1.6, 1.0]]) {
    half.push(B(x, z, s, s, h, C.crate, 'crate'));
  }
  // hedges
  half.push(B(-36, 36, 10, 1.4, 1.6, C.hedge, 'hedge'), B(-36, -36, 10, 1.4, 1.6, C.hedge, 'hedge'));
  half.push(B(-18, 36.4, 6, 1.4, 1.6, C.hedge, 'hedge'), B(-18, -36.4, 6, 1.4, 1.6, C.hedge, 'hedge'));

  boxes.push(...mirror(half), ...perimeter(W, D, 4, '#f2a7b8'));

  return {
    id: 'plaza', name: 'Sticky Plaza',
    width: W, depth: D,
    sky: ['#6ec2ff', '#e2f4ff'], fog: '#d4ecff', ground: '#8fd16a', path: '#f3e1b5', pathStyle: 'path',
    sun: { color: '#fff2d6', intensity: 2.2, dir: [-0.5, 1, 0.35] }, hemi: ['#d6efff', '#7da35e', 1.2],
    boxes,
    trees: mirrorPts([[-8, 30], [-30, 22], [-47, 36], [-47, -36], [-27, -31.5], [-3.5, -36], [-8, -30]]).map(([x, z]) => ({ x, z })),
    decor: [{ type: 'statue', x: 0, z: 0, y: 2.2 }, ...mirrorPts([[-24, 0.5], [-10, 14]]).map(([x, z]) => ({ type: 'lamp', x, z }))],
    paths: [[-50, -2.2, 100, 4.4], [-2.2, -40, 4.4, 80]],
    flags: { 1: [-41.5, 0], 2: [41.5, 0] },
    teamSpawns: { 1: [[-44, 4], [-44, -4], [-40, 12], [-40, -12], [-46.5, 10], [-46.5, -10], [-37, 0]] },
    pickups: mirrorPts([[-26, 0], [-14, 30], [-14, -30], [-38, 26], [-38, -26]]).concat([[0, 22], [0, -22]]),
    night: false,
  };
}

// ---------------------------------------------------------------- Cardboard Depot
function cardboardDepot() {
  const W = 88, D = 66;
  const C = { shelf: '#4f6d9a', shelfB: '#ef8b5b', card: '#c99a63', card2: '#b88752', dock: '#a3a8b8', yellow: '#ffd43b', wall: '#6c7a92', red: '#f06a6a' };
  const half = [];
  for (const z of [-18, -6, 6, 18]) {
    half.push(B(-30, z, 12, 1.6, 3.6, C.shelf, 'shelf'));
    half.push(B(-12, z + (z > 0 ? 1.5 : -1.5), 10, 1.6, 3.6, C.shelfB, 'shelf'));
  }
  for (const [x, z, s, h] of [[-36, 0, 1.4, 1.0], [-34.6, 0.5, 1.0, 0.7], [-22, 12, 1.6, 1.4], [-22, -12, 1.6, 1.4], [-18, 0, 2, 1.0], [-6, 12.5, 1.4, 1.0], [-6, -12.5, 1.4, 1.0],
    [-26, 24, 1.6, 1.0], [-26, -24, 1.6, 1.0], [-42, 12, 1.2, 0.9], [-42, -12, 1.2, 0.9], [-9, 26, 1.2, 0.8], [-9, -26, 1.2, 0.8]]) {
    half.push(B(x, z, s, s, h, C.card, 'cardboard'));
  }
  // loading docks with a railing you can crouch behind
  for (const s of [1, -1]) {
    half.push(B(-30, 29.5 * s, 22, 5, 1.2, C.dock));
    half.push(...flight(-19, 29.5 * s, '+x', 3, 1.2, C.dock));
    half.push(B(-30.5, 27.3 * s, 21, 0.5, 1.0, C.yellow, 'block', 1.2));
  }
  half.push(B(-38, 7.5, 0.8, 5, 2.4, C.red), B(-38, -7.5, 0.8, 5, 2.4, C.red));
  half.push(B(-41, 22, 6, 6, 3.2, C.wall), B(-41, -22, 6, 6, 3.2, C.wall));

  const boxes = mirror(half);
  // centre: a climbable stack of boxes
  boxes.push(B(0, 0, 8, 8, 1.0, C.card2, 'cardboard'));
  boxes.push(B(0, 0, 4, 4, 1.0, C.card, 'cardboard', 1.0));
  boxes.push(...flight(0, 4, '+z', 3, 1.0, C.card2, 'cardboard'), ...flight(0, -4, '-z', 3, 1.0, C.card2, 'cardboard'));
  boxes.push(...flight(4, 0, '+x', 3, 1.0, C.card2, 'cardboard'), ...flight(-4, 0, '-x', 3, 1.0, C.card2, 'cardboard'));
  boxes.push(B(0, 2.5, 3, 1, 0.5, C.card, 'cardboard', 1.0)); // half steps up to the top tier
  boxes.push(B(0, -2.5, 3, 1, 0.5, C.card, 'cardboard', 1.0));
  boxes.push(B(-0.9, -0.9, 1.2, 1.2, 0.9, C.yellow, 'block', 2.0));
  boxes.push(B(0, 24, 6, 1, 1.15, C.yellow), B(0, -24, 6, 1, 1.15, C.yellow));
  boxes.push(B(0, 13, 1.5, 1.5, 1.2, C.card, 'cardboard'), B(0, -13, 1.5, 1.5, 1.2, C.card, 'cardboard'));
  boxes.push(...perimeter(W, D, 5, '#55607a'));

  return {
    id: 'depot', name: 'Cardboard Depot',
    width: W, depth: D,
    sky: ['#ffa86e', '#ffe6c9'], fog: '#f5d2b2', ground: '#b9b5ad', path: '#ffd43b', pathStyle: 'stripe',
    sun: { color: '#ffe0bd', intensity: 2.0, dir: [0.4, 1, -0.6] }, hemi: ['#ffe9d6', '#8a7f72', 1.25],
    boxes, trees: [],
    decor: [{ type: 'forklift', x: -22, z: 2.2 }, { type: 'forklift', x: 22, z: -2.2, rot: Math.PI }],
    paths: [[-44, -0.6, 88, 1.2], [-44, 32, 88, 0.4], [-44, -32.4, 88, 0.4]],
    flags: { 1: [-41, 0], 2: [41, 0] },
    teamSpawns: { 1: [[-42, 4], [-42, -4], [-43, 15], [-43, -15], [-36, 3.5], [-36, -3.5]] },
    pickups: mirrorPts([[-24, 0], [-30, 30], [-30, -30], [-12, 0]]).concat([[1.2, 1.2]]),
    night: false,
  };
}

// ---------------------------------------------------------------- Neon Rooftops
function neonRooftops() {
  const W = 92, D = 72;
  const C = { roofA: '#40336f', roofB: '#2c4c78', roofC: '#5e3669', vent: '#8b8fb3', red: '#ff5470', pink: '#ff7ad9', cyan: '#4ff0e8', lime: '#b8ff5c', crate: '#7a5a8a', tank: '#9aa3c7', walk: '#4a3a78' };
  const half = [];
  // base roof with stairs down to the street
  half.push(B(-38, 0, 16, 22, 3.0, C.roofA));
  half.push(...flight(-30, 7, '+x', 3, 3.0, C.roofA), ...flight(-30, -7, '+x', 3, 3.0, C.roofA));
  half.push(B(-42, 3, 2, 2, 1.0, C.vent, 'block', 3.0), B(-42, -3, 2, 2, 1.0, C.vent, 'block', 3.0));
  half.push(B(-33.6, 0, 0.8, 6, 1.15, C.red, 'block', 3.0));
  for (const s of [1, -1]) {
    // tall towers linked to the base roof by a bridge
    half.push(B(-38, 24 * s, 14, 14, 4.0, C.roofB));
    half.push(B(-38, 13.5 * s, 3, 5, 3.0, C.roofA));
    half.push(B(-38, 16.5 * s, 3, 1, 3.5, C.roofA));
    half.push(...flight(-31, 27 * s, '+x', 3, 4.0, C.roofB));
    half.push(B(-40, 26 * s, 3, 3, 2.0, C.tank, 'block', 4.0));
    // mid roofs
    half.push(B(-18, 20 * s, 8, 10, 2.0, C.roofC));
    half.push(...flight(-18, 15 * s, s > 0 ? '-z' : '+z', 3, 2.0, C.roofC));
    half.push(B(-18, 22 * s, 2, 2, 1.0, C.vent, 'block', 2.0));
  }
  for (const [x, z, s, h] of [[-14, 6, 1.6, 1.0], [-14, -6, 1.6, 1.0], [-10, 30, 1.6, 1.0], [-10, -30, 1.6, 1.0], [-26, 32.5, 1.6, 1.2], [-26, -32.5, 1.6, 1.2], [-24, 0, 1.4, 1.0]]) {
    half.push(B(x, z, s, s, h, C.crate, 'crate'));
  }
  half.push(B(-8, 14, 0.8, 8, 1.15, C.pink), B(-8, -14, 0.8, 8, 1.15, C.cyan));

  const boxes = mirror(half);
  // centre walkway
  boxes.push(B(0, 0, 6, 18, 2.0, C.walk));
  boxes.push(...flight(0, 9, '+z', 3, 2.0, C.walk), ...flight(0, -9, '-z', 3, 2.0, C.walk));
  boxes.push(B(0, 3, 5, 0.6, 1.0, C.pink, 'block', 2.0), B(0, -3, 5, 0.6, 1.0, C.cyan, 'block', 2.0));
  boxes.push(B(0, 26, 2, 2, 1.2, C.crate, 'crate'), B(0, -26, 2, 2, 1.2, C.crate, 'crate'));
  boxes.push(...perimeter(W, D, 5.5, '#2b2550'));

  return {
    id: 'neon', name: 'Neon Rooftops',
    width: W, depth: D,
    sky: ['#2b1d5c', '#ff94b6'], fog: '#5b4282', ground: '#3a3550', path: '#4ff0e8', pathStyle: 'neon',
    sun: { color: '#ffc0dc', intensity: 1.4, dir: [0.6, 0.55, 0.3] }, hemi: ['#c2adff', '#3b2a55', 1.45],
    boxes, trees: [],
    decor: [
      { type: 'sign', x: -30.02, z: -1, y: 4.6, color: '#ff7ad9', text: 'READ ME', rot: Math.PI / 2 },
      { type: 'sign', x: 30.02, z: 1, y: 4.6, color: '#4ff0e8', text: 'TYPE IT', rot: -Math.PI / 2 },
      { type: 'sign', x: -14, z: 25.02, y: 2.8, color: '#b8ff5c', text: '24/7', rot: 0 },
      { type: 'sign', x: 14, z: -25.02, y: 2.8, color: '#ffd43b', text: 'SUMS', rot: Math.PI },
      { type: 'sign', x: 0, z: 35.95, y: 3.6, color: '#ff5470', text: '?????', rot: Math.PI },
    ],
    paths: [[-46, -0.5, 92, 1.0], [-46, 35, 92, 0.3], [-46, -35.3, 92, 0.3]],
    flags: { 1: [-41, 0], 2: [41, 0] },
    teamSpawns: { 1: [[-42, 6.5], [-42, -6.5], [-36, 8], [-36, -8], [-44.5, 0]] },
    pickups: mirrorPts([[-35, 22], [-35, -22], [-16, 18], [-16, -18], [-14, 0]]).concat([[0, 0]]),
    night: true,
  };
}

function finalize(m) {
  m.teamSpawns[2] = m.teamSpawns[1].map(([x, z]) => [-x, z]);
  m.boxes = m.boxes.filter(b => b && b.h > 0.02 && b.w > 0.02 && b.d > 0.02);
  return m;
}

export const MAPS = {
  plaza: () => finalize(stickyPlaza()),
  depot: () => finalize(cardboardDepot()),
  neon: () => finalize(neonRooftops()),
};

export const MAP_LIST = [
  { id: 'plaza', name: 'Sticky Plaza', blurb: 'Sunny town square. Rooftops, hedges and a suspicious statue.' },
  { id: 'depot', name: 'Cardboard Depot', blurb: 'Warehouse aisles, tight corners, short sightlines.' },
  { id: 'neon', name: 'Neon Rooftops', blurb: 'Dusk over the city. High ground and glowing signs.' },
];
