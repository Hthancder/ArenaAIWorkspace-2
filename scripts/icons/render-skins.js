// HolySic app icon skins — same artwork and layout as assets/icon-source.svg (gradient field,
// calligraphic eighth note, tilted halo); only the materials change.
//
//   NODE_PATH=/path/to/node_modules node scripts/icons/render-skins.js
//   (needs @resvg/resvg-js and pngjs)
//
// Writes assets/app-icons/<id>.png (1024², opaque — iOS alternate icons) and
// assets/app-icons/preview/<id>.png (180², for the picker in Settings).

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets', 'icon-source.svg'), 'utf8');

// every colour of the original, by role
const BASE = {
  bg: ['#341A66', '#170B30', '#07050D'],
  bloom: ['#9A6BE0', '#5B2FA0', '#2A1452'],
  gold: ['#FFF6D6', '#FCE29A', '#F2B843', '#B9761A'],
  halo: ['#E9A93A', '#FFF4CF', '#FDE68A', '#D48F22'],
  shadow: '#05030A',
  hi: ['#FFF8E1', '#FFFBEA'],
};

const GOLD = BASE.gold;
const HALO = BASE.halo;

/** id → material overrides (anything left out keeps the original) */
const SKINS = {
  midnight: {
    bg: ['#1C2645', '#0C1126', '#04050A'],
    bloom: ['#7088CC', '#33437A', '#151C38'],
    gold: ['#FFFFFF', '#E9EDF5', '#B9C2D3', '#6D7790'],
    halo: ['#8D97AB', '#FFFFFF', '#E4E9F2', '#7A8398'],
    hi: ['#FFFFFF', '#FFFFFF'],
  },
  rose: {
    bg: ['#5C1A3A', '#2B0B1D', '#0B0408'],
    bloom: ['#E27FAA', '#A23668', '#4A1230'],
    gold: ['#FFF1EB', '#F9D0C2', '#E59C87', '#A4584A'],
    halo: ['#D58670', '#FFEFE8', '#F7C7B7', '#B56A56'],
    hi: ['#FFF4F0', '#FFF6F2'],
  },
  emerald: {
    bg: ['#0F4C3B', '#07271F', '#030B08'],
    bloom: ['#52D3A8', '#1F7A5E', '#0B3328'],
  },
  ocean: {
    bg: ['#0F3D69', '#071D37', '#03080F'],
    bloom: ['#5EB9F2', '#1F6AA8', '#0A2A4A'],
    gold: ['#F4FFFF', '#D2F6F8', '#90DCE7', '#3B8BA6'],
    halo: ['#68C3D8', '#F2FFFF', '#C4F1F6', '#3C97B3'],
    hi: ['#F4FFFF', '#F8FFFF'],
  },
  ember: {
    bg: ['#6C2C11', '#351306', '#0D0502'],
    bloom: ['#FF9C5C', '#C4541F', '#5A200A'],
    gold: ['#FFF9E8', '#FFE4AA', '#F8BA56', '#BE781F'],
  },
  ivory: {
    bg: ['#FFFBF1', '#F1E8D3', '#DACCAF'],
    bloom: ['#FFFFFF', '#FFF6DF', '#F3E6C6'],
    gold: ['#7B4FC6', '#55299A', '#33156E', '#1A0A3E'],
    shadow: '#5A4320',
    vignette: 0.16,
    shadowOpacity: 0.3,
  },
  oled: {
    bg: ['#0B0B0C', '#050505', '#000000'],
    bloom: ['#8C6A2C', '#3B2A10', '#000000'],
  },
};

function skinSvg(over) {
  let s = SRC;
  const swap = (from, to) => {
    from.forEach((c, i) => {
      if (to && to[i]) s = s.split(`"${c}"`).join(`"__${i}_${to[i]}"`);
    });
  };
  const roles = ['bg', 'bloom', 'gold', 'halo', 'hi'];
  // gold and halo share no hex, but #FDE68A appears in both the halo gradient and the glow
  // stroke — both belong to the halo, so a plain swap is right
  for (const r of roles)
    swap(BASE[r], over[r] || (r === 'gold' ? GOLD : r === 'halo' ? HALO : null));
  s = s.replace(/"__\d+_(#[0-9A-Fa-f]{6})"/g, '"$1"');
  if (over.shadow) s = s.split(`"${BASE.shadow}"`).join(`"${over.shadow}"`);
  if (over.vignette != null)
    s = s.replace(
      '<stop offset="1" stop-color="#000" stop-opacity="0.45"/>',
      `<stop offset="1" stop-color="#000" stop-opacity="${over.vignette}"/>`
    );
  if (over.shadowOpacity != null)
    s = s.replace(
      `fill="${over.shadow || BASE.shadow}" opacity="0.55"`,
      `fill="${over.shadow || BASE.shadow}" opacity="${over.shadowOpacity}"`
    );
  return s;
}

/** RGBA → opaque RGB PNG (iOS rejects icons with an alpha channel) */
function opaque(pngBuf) {
  const src = PNG.sync.read(pngBuf);
  const out = new PNG({ width: src.width, height: src.height, colorType: 2, inputHasAlpha: true });
  src.data.copy(out.data);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return PNG.sync.write(out, { colorType: 2 });
}

const outDir = path.join(ROOT, 'assets', 'app-icons');
fs.mkdirSync(path.join(outDir, 'preview'), { recursive: true });
const all = { default: {}, ...SKINS };
for (const [id, over] of Object.entries(all)) {
  const svg = skinSvg(over);
  const full = opaque(new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng());
  const small = opaque(new Resvg(svg, { fitTo: { mode: 'width', value: 180 } }).render().asPng());
  if (id !== 'default') fs.writeFileSync(path.join(outDir, `${id}.png`), full);
  fs.writeFileSync(path.join(outDir, 'preview', `${id}.png`), small);
  console.log(id, full.length, small.length);
}
