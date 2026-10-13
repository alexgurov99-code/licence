import { describe, expect, it } from 'vitest';
import { createCar } from '../vehicle/car';
import { INDICATORS_OFF } from '../vehicle/indicators';
import { clusterReadout } from './instrumentCluster';

describe('clusterReadout', () => {
  it('shows the starting state: P, handbrake, belt and engine-off lamps lit', () => {
    expect(clusterReadout(createCar())).toEqual({
      speedKmh: 0,
      gear: 'P',
      leftArrow: false,
      rightArrow: false,
      handbrakeLamp: true,
      beltLamp: true,
      engineOffLamp: true,
    });
  });

  it('shows speed in whole km/h, also when reversing', () => {
    expect(clusterReadout(createCar({ motion: { speed: -10 / 3.6 } })).speedKmh).toBe(10);
    expect(clusterReadout(createCar({ motion: { speed: 49.6 / 3.6 } })).speedKmh).toBe(50);
  });

  it('flashes the arrow on the signalled side', () => {
    const indicators = { ...INDICATORS_OFF, lever: 'right' as const, flasherTime: 0.01 };
    const readout = clusterReadout(createCar({ controls: { indicators } }));
    expect(readout.rightArrow).toBe(true);
    expect(readout.leftArrow).toBe(false);
  });

  it('turns lamps off once the driver is ready', () => {
    const ready = createCar({ controls: { engineOn: true, handbrake: false, beltFastened: true, gear: 'D' } });
    expect(clusterReadout(ready)).toMatchObject({ handbrakeLamp: false, beltLamp: false, engineOffLamp: false, gear: 'D' });
  });
});
