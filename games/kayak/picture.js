// The menu's pictures of your paddler and boat, as SVG markup, drawn from a
// kit (kit.js) whose colours are already checked "#rrggbb". Flat and simple,
// a match for the game's look. Pure: no DOM.
import { boatById, hullFor } from './boats.js';

// Face on, sitting in the boat holding the paddle: viewBox 0 0 120 120.
export function paddlerSvg(kit) {
  const arm = (side) => {
    const [sx, hx] = side < 0 ? [43, 22] : [77, 98];
    const elbow = [sx + side * 9, 74];
    const sleeve = kit.sleeves === 'long'
      ? `<path d="M${sx} 56 L${elbow[0]} ${elbow[1]} L${hx} 82" stroke="${kit.top}" />`
      : `<path d="M${sx} 56 L${(sx + elbow[0]) / 2} 65" stroke="${kit.top}" /><path d="M${(sx + elbow[0]) / 2} 65 L${elbow[0]} ${elbow[1]} L${hx} 82" stroke="${kit.skin}" stroke-width="7" />`;
    return `<g fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${sleeve}</g><circle cx="${hx}" cy="82" r="5" fill="${kit.skin}" />`;
  };
  const head = kit.head === 'hair'
    ? `<path d="M45 34 Q45 15 60 15 Q75 15 75 34 Q75 26 68 24 Q60 30 50 25 Q45 28 45 34Z" fill="${kit.headColour}" />`
    : `<path d="M45 30 Q45 16 60 16 Q75 16 75 30Z" fill="${kit.headColour}" /><path d="M58 29 L82 29 Q82 33 74 33 L58 33Z" fill="${kit.headColour}" />`;
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
    <path d="M40 56 Q60 48 80 56 L76 96 L44 96Z" fill="${kit.top}" />
    <rect x="55" y="42" width="10" height="10" fill="${kit.skin}" />
    <circle cx="60" cy="33" r="15" fill="${kit.skin}" />
    ${head}
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
