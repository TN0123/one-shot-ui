// Perceptual color distance for the fidelity scorer. CIEDE2000 (Lab) instead of
// RGB L2 because human color judgment is what we're scoring — a small hue shift a
// person barely notices should not read as a large error, and vice-versa.

export type Rgb = { r: number; g: number; b: number };
export type Lab = [L: number, a: number, b: number];

/** Parse "#rrggbb", "rgb(r,g,b)", or "rgba(r,g,b,a)". Returns null if unrecognized. */
export function parseCssColor(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{6})$/);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const hex3 = s.match(/^#([0-9a-f]{3})$/);
  if (hex3) {
    const [r, g, b] = hex3[1]!.split("").map((c) => parseInt(c + c, 16));
    return { r: r!, g: g!, b: b! };
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** sRGB (D65) → CIE Lab. */
export function rgbToLab({ r, g, b }: Rgb): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // linear sRGB → XYZ (D65)
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const atan2deg = (y: number, x: number) => {
  const d = deg(Math.atan2(y, x));
  return d >= 0 ? d : d + 360;
};

/** CIEDE2000 color difference between two Lab colors. 0 = identical. */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = a1p === 0 && b1 === 0 ? 0 : atan2deg(b1, a1p);
  const h2p = a2p === 0 && b2 === 0 ? 0 : atan2deg(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    let diff = h2p - h1p;
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    dhp = diff;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;

  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH),
  );
}

/** Convenience: perceptual distance between two CSS color strings (Infinity if either is unparseable). */
export function colorDelta(a: string | null | undefined, b: string | null | undefined): number {
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  if (!ca || !cb) return Infinity;
  return deltaE2000(rgbToLab(ca), rgbToLab(cb));
}
