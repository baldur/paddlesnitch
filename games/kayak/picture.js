// The menu's pictures of your paddler and boat, as SVG markup, drawn from a
// kit (kit.js) whose colours are already checked "#rrggbb". Flat and simple,
// a match for the game's look. Pure: no DOM.
import { boatById, hullFor } from './boats.js';

// Face on, sitting in the boat holding the paddle: viewBox 0 0 120 120. A
// body type, a face, hair under a hat, a beard, a buoyancy aid.
const shade = (hex, by) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - by)).toString(16).padStart(2, '0')).join('');
export function paddlerSvg(kit) {
  const narrow = kit.body !== 'broad';
  const arm = (side) => {
    const [sx, hx] = side < 0 ? [narrow ? 46 : 43, 22] : [narrow ? 74 : 77, 98];
    const elbow = [sx + side * 9, 74];
    const sleeve = kit.sleeves === 'long'
      ? `<path d="M${sx} 56 L${elbow[0]} ${elbow[1]} L${hx} 82" stroke="${kit.top}" />`
      : `<path d="M${sx} 56 L${(sx + elbow[0]) / 2} 65" stroke="${kit.top}" /><path d="M${(sx + elbow[0]) / 2} 65 L${elbow[0]} ${elbow[1]} L${hx} 82" stroke="${kit.skin}" stroke-width="${narrow ? 6 : 7}" />`;
    return `<g fill="none" stroke-width="${narrow ? 8 : 9}" stroke-linecap="round" stroke-linejoin="round">${sleeve}</g><circle cx="${hx}" cy="82" r="5" fill="${kit.skin}" />`;
  };
  const hair = kit.hairColour;
  const hatted = kit.hat === 'cap' || kit.hat === 'beanie'; // a visor has no crown
  // Behind the head and body: long hair, a ponytail, a bun on top.
  const back = {
    long: `<path d="M44 30 Q41 54 47 60 L73 60 Q79 54 76 30Z" fill="${hair}" />`,
    ponytail: `<path d="M71 27 Q88 32 83 56 Q79 44 70 36Z" fill="${hair}" />`,
    bun: hatted ? `<circle cx="74" cy="22" r="6" fill="${hair}" />` : `<circle cx="60" cy="15" r="6.5" fill="${hair}" />`,
  }[kit.hair] ?? '';
  const crown = hatted ? '' : {
    short: `<path d="M45 34 Q45 15 60 15 Q75 15 75 34 Q75 26 68 24 Q60 30 50 25 Q45 28 45 34Z" fill="${hair}" />`,
    crop: `<path d="M46 29 Q46 17 60 17 Q74 17 74 29 Q68 22 60 22 Q52 22 46 29Z" fill="${hair}" />`,
    ponytail: `<path d="M45 33 Q45 15 60 15 Q75 15 75 33 Q73 24 60 23 Q47 24 45 33Z" fill="${hair}" />`,
    bun: `<path d="M45 33 Q45 15 60 15 Q75 15 75 33 Q73 24 60 23 Q47 24 45 33Z" fill="${hair}" />`,
    long: `<path d="M45 36 Q45 15 60 15 Q75 15 75 36 Q73 24 62 23 Q52 27 47 26 Q45 30 45 36Z" fill="${hair}" />`,
  }[kit.hair] ?? '';
  const hat = {
    cap: `<path d="M45 30 Q45 16 60 16 Q75 16 75 30Z" fill="${kit.hatColour}" /><path d="M68 27 L84 28 Q84 32 77 32 L68 31Z" fill="${kit.hatColour}" />`,
    visor: `<rect x="45" y="25" width="30" height="5" rx="2" fill="${kit.hatColour}" /><path d="M68 26 L84 27 Q84 31 77 31 L68 30Z" fill="${kit.hatColour}" />`,
    beanie: `<path d="M44 30 Q44 13 60 13 Q76 13 76 30Z" fill="${kit.hatColour}" /><rect x="43" y="25" width="34" height="7" rx="3" fill="${shade(kit.hatColour, 0.2)}" /><circle cx="60" cy="12" r="4" fill="${kit.hatColour}" />`,
  }[kit.hat] ?? '';
  const brow = kit.hair === 'none' ? shade(kit.skin, 0.45) : hair;
  const face = `
    <circle cx="54.5" cy="33" r="1.7" fill="#1c1917" /><circle cx="65.5" cy="33" r="1.7" fill="#1c1917" />
    <path d="M51.5 29.5 L57.5 29" stroke="${brow}" stroke-width="1.6" stroke-linecap="round" /><path d="M62.5 29 L68.5 29.5" stroke="${brow}" stroke-width="1.6" stroke-linecap="round" />
    <path d="M60 34 L59 38.5 L61 38.5" stroke="${shade(kit.skin, 0.25)}" stroke-width="1.1" fill="none" stroke-linecap="round" />
    <path d="M56 42 Q60 44.5 64 42" stroke="${shade(kit.skin, 0.4)}" stroke-width="1.6" fill="none" stroke-linecap="round" />`;
  const beard = {
    stubble: `<path d="M46 36 Q47 49 60 50 Q73 49 74 36 Q70 45 60 45 Q50 45 46 36Z" fill="${hair}" opacity="0.35" />`,
    moustache: `<path d="M54 40.5 Q60 38 66 40.5 Q60 42 54 40.5Z" fill="${hair}" />`,
    beard: `<path d="M46 36 Q47 50 60 51 Q73 50 74 36 Q71 44 66 44 Q60 46 54 44 Q49 44 46 36Z" fill="${hair}" /><path d="M54 40.5 Q60 38 66 40.5 Q60 42 54 40.5Z" fill="${hair}" />`,
  }[kit.beard] ?? '';
  const torso = {
    curvy: 'M45 57 Q60 50 75 57 Q73 68 70 74 Q75 85 76 96 L44 96 Q45 85 50 74 Q47 68 45 57Z',
    slim: 'M45 57 Q60 51 75 57 L73 96 L47 96Z',
  }[kit.body] ?? 'M40 56 Q60 48 80 56 L76 96 L44 96Z';
  const aid = !kit.aid ? '' : `
    <path d="${{ curvy: 'M47 60 Q60 55 73 60 Q72 70 70 75 Q73 82 74 89 L46 89 Q47 82 50 75 Q48 70 47 60Z', slim: 'M47 60 Q60 55 73 60 L72 89 L48 89Z' }[kit.body] ?? 'M43 59 Q60 54 77 59 L75 89 L45 89Z'}" fill="${kit.aidColour}" />
    <rect x="${narrow ? 47 : 45}" y="79" width="${narrow ? 26 : 30}" height="3.5" fill="${shade(kit.aidColour, 0.6)}" /><rect x="57" y="78" width="6" height="5.5" rx="1" fill="#d4d4d0" />`;
  const frame = '#18181b';
  const lens = kit.glassesColour;
  const glasses = {
    none: '',
    wrap: `<path d="M45 29 Q60 26 75 29 L74 35 Q60 37 46 35Z" fill="${lens}" stroke="${frame}" stroke-width="1.2" />`,
    round: `<circle cx="54" cy="32" r="4.6" fill="${lens}" stroke="${frame}" stroke-width="1.4" /><circle cx="66" cy="32" r="4.6" fill="${lens}" stroke="${frame}" stroke-width="1.4" /><path d="M58.6 31 Q60 30 61.4 31" stroke="${frame}" fill="none" stroke-width="1.2" />`,
    aviator: `<path d="M48 29 L59 29 Q59 37 54 37 Q48 37 48 29Z" fill="${lens}" stroke="${frame}" stroke-width="1.2" /><path d="M61 29 L72 29 Q72 37 66 37 Q61 37 61 29Z" fill="${lens}" stroke="${frame}" stroke-width="1.2" /><line x1="58" y1="29" x2="62" y2="29" stroke="${frame}" stroke-width="1.2" />`,
    square: `<rect x="48" y="28.5" width="10" height="7" fill="${lens}" stroke="${frame}" stroke-width="1.4" /><rect x="62" y="28.5" width="10" height="7" fill="${lens}" stroke="${frame}" stroke-width="1.4" /><line x1="58" y1="31" x2="62" y2="31" stroke="${frame}" stroke-width="1.4" />`,
  }[kit.glasses] ?? '';
  return `
    <line x1="6" y1="83" x2="114" y2="81" stroke="${kit.shaftColour}" stroke-width="3" stroke-linecap="round" />
    ${kit.paddle === 'flat'
    ? `<rect x="2" y="74" width="12" height="17" rx="3" fill="${kit.bladeColour}" /><rect x="106" y="72" width="12" height="17" rx="3" fill="${kit.bladeColour}" />`
    : `<path d="M2 80 L8 74 L16 76 L14 90 L6 90Z" fill="${kit.bladeColour}" /><path d="M118 78 L112 72 L104 74 L106 88 L114 88Z" fill="${kit.bladeColour}" />`}
    ${back}
    <path d="${torso}" fill="${kit.top}" />
    ${aid}
    <rect x="${narrow ? 56 : 55}" y="42" width="${narrow ? 8 : 10}" height="10" fill="${kit.skin}" />
    <circle cx="60" cy="33" r="15" fill="${kit.skin}" />
    ${face}
    ${beard}
    ${crown}
    ${hat}
    ${glasses}
    ${arm(-1)}${arm(1)}
    <path d="M8 96 Q60 86 112 96 Q60 112 8 96Z" fill="${kit.deck}" />
    <path d="M36 95 Q60 90 84 95" stroke="${kit.stripe}" stroke-width="3" fill="none" />`;
}

// From above, bow to the right: viewBox 0 0 240 60. Wider for a more stable
// boat; with wings, the deck comes to a point either side of the cockpit.
export function boatSvg(kit) {
  const { beam } = hullFor(boatById(kit.boat)?.stability ?? 5);
  const w = 13 * beam; // half the width at the widest
  const top = 30 - w;
  const bottom = 30 + w;
  const outline = kit.deckShape === 'wings'
    ? `M6 30 Q70 ${top + 2} 121 ${top - 5} Q200 ${top + 2} 234 30 Q200 ${bottom - 2} 121 ${bottom + 5} Q70 ${bottom - 2} 6 30Z`
    : `M6 30 Q70 ${top} 130 ${top} Q200 ${top} 234 30 Q200 ${bottom} 130 ${bottom} Q70 ${bottom} 6 30Z`;
  return `
    <path d="${outline}" fill="${kit.deck}" stroke="rgb(0 0 0 / 0.35)" stroke-width="1" />
    <line x1="18" y1="30" x2="96" y2="30" stroke="${kit.stripe}" stroke-width="3" stroke-linecap="round" />
    <line x1="146" y1="30" x2="222" y2="30" stroke="${kit.stripe}" stroke-width="3" stroke-linecap="round" />
    <ellipse cx="121" cy="30" rx="22" ry="${(w * 0.62).toFixed(1)}" fill="#18181b" stroke="rgb(255 255 255 / 0.55)" stroke-width="1.5" />`;
}

// Cut across at the cockpit, as if from the bow: viewBox 0 0 80 50. The deck
// on top, the hull in the water; wings flare at the deck, a V'd keel comes to
// a point underneath.
export function sectionSvg(kit) {
  const { beam } = hullFor(boatById(kit.boat)?.stability ?? 5);
  const w = 18 * beam;
  const [l, r] = [40 - w, 40 + w];
  const wing = kit.deckShape === 'wings' ? 7 : 0;
  const bottom = kit.hullShape === 'vee'
    ? `L${r - 5} 28 L40 37 L${l + 5} 28`
    : `Q${r} 35 40 35 Q${l} 35 ${l} 22`;
  const shape = `M${l - wing} 18 Q40 6 ${r + wing} 18 L${r} 22 ${bottom} Z`;
  return `
    <rect x="0" y="22" width="80" height="28" fill="#5f9dbd" />
    <path d="${shape}" fill="${kit.hullColour}" />
    <clipPath id="aboveWater"><rect width="80" height="19" /></clipPath>
    <path d="${shape}" fill="${kit.deck}" clip-path="url(#aboveWater)" />
    <path d="${shape}" fill="none" stroke="rgb(0 0 0 / 0.4)" stroke-width="1" />
    <line x1="0" y1="22" x2="80" y2="22" stroke="rgb(255 255 255 / 0.6)" stroke-width="1" />`;
}

// The paddle, shaft across: viewBox 0 0 240 50. Wing blades are lopsided
// spoons, flat ones symmetrical.
export function paddleSvg(kit) {
  const blade = kit.paddle === 'flat'
    ? (x, dir) => `<path d="M${x} 25 L${x + dir * 6} 13 Q${x + dir * 40} 10 ${x + dir * 46} 14 L${x + dir * 46} 36 Q${x + dir * 40} 40 ${x + dir * 6} 37Z" fill="${kit.bladeColour}" stroke="rgb(0 0 0 / 0.3)" />`
    : (x, dir) => `<path d="M${x} 25 Q${x + dir * 10} 9 ${x + dir * 34} 8 Q${x + dir * 48} 9 ${x + dir * 46} 22 Q${x + dir * 40} 40 ${x + dir * 18} 34 Q${x + dir * 6} 31 ${x} 25Z" fill="${kit.bladeColour}" stroke="rgb(0 0 0 / 0.3)" />`;
  return `
    <line x1="50" y1="25" x2="190" y2="25" stroke="${kit.shaftColour}" stroke-width="5" stroke-linecap="round" />
    ${blade(52, -1)}${blade(188, 1)}`;
}

// The two clubs on the walk's opening view (club.js), as little pictures for their cards.
export function clubSvg(which) {
  const sky = '<rect width="120" height="80" fill="#bcdcef"/>';
  if (which === 'cruise') {
    return `<svg viewBox="0 0 120 80" aria-hidden="true">${sky}
      <rect y="50" width="120" height="30" fill="#4f7f86"/>
      <path d="M8 50h96l10 -6h-8v-8h-90v8h-14z" fill="#f2f2ee"/><rect x="10" y="45" width="100" height="3" fill="#1c3880"/>
      <rect x="20" y="28" width="70" height="9" fill="#33475a"/><rect x="18" y="26" width="76" height="3" fill="#f2f2ee"/>
      ${[24, 34, 44, 54, 64, 74, 84].map((x) => `<rect x="${x}" y="29" width="1.5" height="8" fill="#f2f2ee"/>`).join('')}
      <path d="M95 36l14 0" stroke="#f2f2ee" stroke-width="1.5"/><circle cx="104" cy="38" r="2.2" fill="none" stroke="#f08a24" stroke-width="1.5"/>
      <path d="M6 60q12 -3 24 0q12 3 24 0" fill="none" stroke="#e8f2f4" stroke-width="1.2"/>
    </svg>`;
  }
  if (which === 'hire') {
    return `<svg viewBox="0 0 120 80" aria-hidden="true">${sky}
      <rect y="48" width="120" height="32" fill="#4f7f86"/>
      <path d="M22 50h70l14 -7h-90z" fill="#efe6cf"/><rect x="18" y="43" width="86" height="2.5" fill="#7a4a24"/>
      <rect x="54" y="26" width="40" height="3" fill="#1f2a55"/><rect x="56" y="29" width="1.5" height="14" fill="#c9c9c4"/><rect x="91" y="29" width="1.5" height="14" fill="#c9c9c4"/>
      <circle cx="64" cy="38" r="3.5" fill="#d9a27c"/><rect x="61" y="40" width="7" height="4" fill="#2a6fd6"/>
      <path d="M100 52q8 2 16 0" fill="none" stroke="#e8f2f4" stroke-width="1.2"/><path d="M4 58q10 -3 20 0" fill="none" stroke="#e8f2f4" stroke-width="1.2"/>
    </svg>`;
  }
  if (which === 'rowing') {
    return `<svg viewBox="0 0 120 80" aria-hidden="true">${sky}
      <rect y="52" width="120" height="28" fill="#4f7f86"/>
      ${[58, 64, 70, 76].map((y, i) => `<path d="M${4 + i * 7} ${y}l6 -3l6 3l6 -3l6 3l6 -3l6 3l6 -3l6 3l6 -3l6 3l6 -3l6 3l6 -3l6 3" fill="none" stroke="#e8f2f4" stroke-width="1.4"/>`).join('')}
      <rect x="14" y="26" width="62" height="27" fill="#e8dcc2"/><path d="M10 27L45 12L80 27Z" fill="#59626b"/>
      <rect x="22" y="36" width="14" height="17" fill="#3d3a36"/><rect x="42" y="36" width="14" height="17" fill="#3d3a36"/>
      <path d="M60 30l12 12M72 30l-12 12" stroke="#7a5534" stroke-width="2"/>
      <path d="M78 66h36l-3 2h-30z" fill="#f4f4f0"/><path d="M80 63l-9 7M108 63l9 7" stroke="#e8e2d0" stroke-width="1.2"/><rect x="69" y="69" width="5" height="2" fill="#7a1f2e"/><rect x="114" y="69" width="5" height="2" fill="#7a1f2e"/>
      <rect x="92" y="56" width="5" height="8" fill="#7a1f2e"/><circle cx="94.5" cy="53.5" r="2.6" fill="#d9a27c"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 80" aria-hidden="true">${sky}
    <rect y="50" width="120" height="12" fill="#6aa05a"/><rect y="62" width="120" height="18" fill="#4f7f86"/>
    <rect x="18" y="24" width="84" height="27" fill="#b5543c"/><path d="M12 25L60 10L108 25Z" fill="#333c45"/>
    <rect x="26" y="33" width="20" height="18" fill="#3a2a20"/><rect x="52" y="33" width="20" height="18" fill="#3a2a20"/><rect x="78" y="33" width="16" height="10" fill="#cfe3ee"/>
    <path d="M14 66q22 -5 44 0q-22 3 -44 0Z" fill="#f2c230"/><path d="M60 72q24 -5 48 0q-24 3 -48 0Z" fill="#d6452b"/>
  </svg>`;
}
