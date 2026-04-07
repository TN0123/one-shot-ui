/**
 * CSS-to-Tailwind conversion utilities.
 * Used by suggest-fixes to emit Tailwind-native guidance.
 */

function cssRadiusToTailwind(px: number): string {
  if (px <= 2) return "rounded-sm";
  if (px <= 4) return "rounded";
  if (px <= 6) return "rounded-md";
  if (px <= 8) return "rounded-lg";
  if (px <= 12) return "rounded-xl";
  if (px <= 16) return "rounded-2xl";
  if (px >= 9999) return "rounded-full";
  return `rounded-[${px}px]`;
}

function cssGapToTailwind(px: number): string {
  const scale: Record<number, string> = { 0: "0", 1: "px", 2: "0.5", 4: "1", 8: "2", 12: "3", 16: "4", 20: "5", 24: "6", 32: "8", 40: "10", 48: "12" };
  const nearest = Object.keys(scale).map(Number).reduce((prev, curr) =>
    Math.abs(curr - px) < Math.abs(prev - px) ? curr : prev
  );
  if (Math.abs(nearest - px) <= 2) {
    return `gap-${scale[nearest]}`;
  }
  return `gap-[${px}px]`;
}

/**
 * Convert a CSS property + value pair into a Tailwind class suggestion.
 */
export function cssToTailwindClass(property: string, value: string): string {
  const v = value.trim();
  const px = Number.parseInt(v);

  switch (property) {
    case "background-color":
      return `bg-[${v}]`;
    case "width":
      return Number.isNaN(px) ? `w-[${v}]` : `w-[${px}px]`;
    case "height":
      return Number.isNaN(px) ? `h-[${v}]` : `h-[${px}px]`;
    case "min-height":
      return Number.isNaN(px) ? `min-h-[${v}]` : `min-h-[${px}px]`;
    case "padding":
      return Number.isNaN(px) ? `p-[${v}]` : `p-[${px}px]`;
    case "padding-top":
      return Number.isNaN(px) ? `pt-[${v}]` : `pt-[${px}px]`;
    case "padding-right":
      return Number.isNaN(px) ? `pr-[${v}]` : `pr-[${px}px]`;
    case "padding-bottom":
      return Number.isNaN(px) ? `pb-[${v}]` : `pb-[${px}px]`;
    case "padding-left":
      return Number.isNaN(px) ? `pl-[${v}]` : `pl-[${px}px]`;
    case "margin":
      return Number.isNaN(px) ? `m-[${v}]` : `m-[${px}px]`;
    case "gap":
      return cssGapToTailwind(Number.isNaN(px) ? 0 : px);
    case "border-radius":
      return cssRadiusToTailwind(Number.isNaN(px) ? 0 : px);
    case "font-size":
      return Number.isNaN(px) ? `text-[${v}]` : `text-[${px}px]`;
    case "font-weight": {
      const w = Number.parseInt(v);
      if (w >= 700) return "font-bold";
      if (w >= 600) return "font-semibold";
      if (w >= 500) return "font-medium";
      if (w >= 400) return "font-normal";
      return `font-[${v}]`;
    }
    case "font-family":
      return v.includes("serif") && !v.includes("sans") ? "font-serif" : "font-sans";
    case "box-shadow":
      return v === "none" ? "shadow-none" : `shadow-[${v.replace(/ /g, "_")}]`;
    case "left":
      return Number.isNaN(px) ? `left-[${v}]` : `left-[${px}px]`;
    case "top":
      return Number.isNaN(px) ? `top-[${v}]` : `top-[${px}px]`;
    default:
      return `[${property}:${v}]`;
  }
}
