import { describe, expect, it } from 'vitest';
import { createGlanceState } from '../camera/glance';
import { createTracker } from '../route/tracker';
import { createCar } from '../vehicle/car';
import { INDICATORS_OFF } from '../vehicle/indicators';
import { rulesSnapshot } from './snapshot';
import { setup } from './testing';

describe('rules snapshot', () => {
  const { network, route } = setup('rules-0');
  const tracker = createTracker(route, network.start);
  const car = (lever: 'left' | 'right' | null, hazard = false): ReturnType<typeof createCar> =>
    createCar({ controls: { indicators: { ...INDICATORS_OFF, lever, hazard } } });

  it('takes the indicator from the stalk, but hazard lights are not a signal', () => {
    expect(rulesSnapshot(1, car('left'), createGlanceState(), tracker, { kind: 'offRoad' }).indicator).toBe('left');
    expect(rulesSnapshot(1, car('left', true), createGlanceState(), tracker, { kind: 'offRoad' }).indicator).toBeNull();
  });

  it('knows a road from a junction', () => {
    const onRoad = rulesSnapshot(1, car(null), createGlanceState(), tracker, {
      kind: 'road',
      roadId: 0,
      roadClass: 'main',
      laneId: 0,
      offset: -0.4,
      place: 'lane',
      s: 10,
      speedLimit: 60,
    });
    expect(onRoad.road).toEqual({ place: 'lane', laneOffset: -0.4, speedLimit: 60 });
    expect(onRoad.inJunction).toBe(false);
    const inJunction = rulesSnapshot(1, car(null), createGlanceState(), tracker, { kind: 'junction', junctionId: 2, junctionKind: 'tee' });
    expect([inJunction.road, inJunction.inJunction]).toEqual([null, true]);
  });
});
