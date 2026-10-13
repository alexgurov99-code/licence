// Facts about the kit models that the scenery layout needs before any model is built: sizes and
// colour presets. Pure data, no Three.js.

export type CarType = 'hatchback' | 'sedan' | 'wagon' | 'ute' | 'van';

/** Length and width of each car type. */
export const CAR_SIZES: Record<CarType, { length: number; width: number }> = {
  hatchback: { length: 4.0, width: 1.75 },
  sedan: { length: 4.7, width: 1.8 },
  wagon: { length: 4.8, width: 1.85 },
  ute: { length: 5.3, width: 1.85 },
  van: { length: 5.0, width: 1.9 },
};

/** A section (lot) is this wide along the street and this deep; its front boundary is at z = +DEPTH / 2. */
export const SECTION_WIDTH = 18;
export const SECTION_DEPTH = 30;

/** Corner shop: building and veranda, x from -6 to 6, z from -5 (back wall) to +5 (veranda edge). */
export const SHOP_WIDTH = 12;
export const SHOP_BACK = -5;
export const SHOP_FRONT = 5;

/** Colour presets for model parameters (hex numbers). */
export const PALETTE = {
  wall: { white: 0xf2efe6, cream: 0xe8dcc0, lightGrey: 0xc9ccc8, paleBlue: 0xb9cbd6, paleGreen: 0xc2cfb2, greyBlue: 0x7d8fa0 },
  roof: { charcoal: 0x4a4f55, green: 0x3f5a45, red: 0x7a3b33, black: 0x2b2d30, lightGrey: 0x9a9ea2 },
  door: { navy: 0x2f4560, red: 0x9c3b32, green: 0x45634a, timber: 0x8a6a48 },
  car: { white: 0xf0f0ec, silver: 0xb8bcc0, darkGrey: 0x55595e, black: 0x1f2124, navy: 0x24364f, red: 0x9c2a2a },
  foliage: { dark: 0x3f6b3a, mid: 0x5a8a45, light: 0x7fa35a },
} as const;
