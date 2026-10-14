// Plain data of the cockpit drill (see cockpit.ts), kept apart so the rules engine can use it
// without pulling in any Three.js maths.

export type MirrorName = 'interior' | 'left' | 'right';

/** What can be adjusted, in the order Tab goes through them. */
export type AdjustItem = 'seat' | MirrorName;
export const ADJUST_ITEMS: readonly AdjustItem[] = ['seat', 'interior', 'left', 'right'];

/** Which parts are adjusted; this is what the rules engine sees. */
export type CockpitReadiness = Readonly<Record<AdjustItem, boolean>>;

export const COCKPIT_READY: CockpitReadiness = { seat: true, interior: true, left: true, right: true };
