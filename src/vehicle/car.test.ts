import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createCar, stepCar, type CarState } from './car';
import { NO_KEYS, type ControlCommand, type ControlEvent, type HeldKeys } from './carControls';

const DT = CONFIG.simulation.fixedStepSeconds;

/** Plays a little driving script: hold some keys for a while, pressing some keys at the start. */
class Driver {
  car: CarState = createCar();
  readonly events: ControlEvent[] = [];

  do(seconds: number, held: Partial<HeldKeys> = {}, commands: ControlCommand[] = []): this {
    const steps = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < steps; i++) {
      const result = stepCar(this.car, { held: { ...NO_KEYS, ...held }, commands: i === 0 ? commands : [] }, DT);
      this.car = result.car;
      this.events.push(...result.events);
    }
    return this;
  }

  /** Belt, engine, D and handbrake off, all with the foot on the brake. */
  getReady(): this {
    return this.do(0.1, {}, [{ type: 'toggleBelt' }])
      .do(0.2, { brake: true })
      .do(0.1, { brake: true }, [{ type: 'toggleEngine' }])
      .do(0.1, { brake: true }, [{ type: 'shift', gear: 'D' }])
      .do(0.1, { brake: true }, [{ type: 'toggleHandbrake' }]);
  }
}

describe('a full start from the kerb', () => {
  it('belt, engine, D, handbrake off: the car waits for the accelerator, then drives off', () => {
    const driver = new Driver().getReady();
    expect(driver.car.motion.speed).toBe(0);
    expect(driver.events.map((e) => e.type)).toEqual([
      'beltFastened',
      'engineStarted',
      'gearSelected',
      'handbrakeReleased',
    ]);

    driver.do(6);
    expect(driver.car.motion.speed).toBe(0);
    driver.do(2, { throttle: true });
    expect(driver.car.motion.speed).toBeGreaterThan(3);
    expect(driver.car.motion.z).toBeGreaterThan(2);
  });

  it('does not move when the accelerator is pressed in P', () => {
    const driver = new Driver().do(0.2, { brake: true }, [{ type: 'toggleEngine' }]).do(3, { throttle: true });
    expect(driver.car.controls.engineOn).toBe(true);
    expect(driver.car.motion.speed).toBe(0);
  });

  it('cannot drive away on the handbrake', () => {
    const driver = new Driver()
      .do(0.2, { brake: true })
      .do(0.1, { brake: true }, [{ type: 'toggleEngine' }])
      .do(0.1, { brake: true }, [{ type: 'shift', gear: 'D' }])
      .do(3, { throttle: true });
    expect(driver.car.controls.handbrake).toBe(true);
    expect(driver.car.motion.speed).toBe(0);
  });

  it('accelerates with the accelerator and stops again with the brake', () => {
    const driver = new Driver().getReady().do(4, { throttle: true });
    expect(driver.car.motion.speed * 3.6).toBeGreaterThan(30);
    driver.do(4, { brake: true });
    expect(driver.car.motion.speed).toBe(0);
  });

  it('reverses in R', () => {
    const driver = new Driver()
      .getReady()
      .do(0.1, { brake: true }, [{ type: 'shift', gear: 'R' }])
      .do(3, { throttle: true });
    expect(driver.car.motion.speed).toBeLessThan(-1);
    expect(driver.car.motion.z).toBeLessThan(0);
  });
});

describe('indicators while driving', () => {
  it('stay on after a turn until switched off by hand', () => {
    const driver = new Driver()
      .getReady()
      .do(2, { throttle: true })
      .do(0.1, {}, [{ type: 'indicator', side: 'left' }])
      .do(3, { steerLeft: true })
      .do(2);
    expect(driver.car.motion.heading).toBeGreaterThan(Math.PI / 4);
    expect(driver.car.controls.indicators.lever).toBe('left');
    driver.do(0.1, {}, [{ type: 'indicator', side: 'left' }]);
    expect(driver.car.controls.indicators.lever).toBeNull();
    expect(driver.events).toContainEqual({ type: 'indicatorOff', side: 'left' });
  });

  it('stay on after a gentle lane change and need switching off by hand', () => {
    const driver = new Driver()
      .getReady()
      .do(4, { throttle: true })
      .do(0.1, {}, [{ type: 'indicator', side: 'right' }])
      .do(0.25, { steerRight: true })
      .do(0.5)
      .do(0.25, { steerLeft: true })
      .do(1);
    expect(driver.car.controls.indicators.lever).toBe('right');

    driver.do(0.1, {}, [{ type: 'indicator', side: 'right' }]);
    expect(driver.car.controls.indicators.lever).toBeNull();
    expect(driver.events).toContainEqual({ type: 'indicatorOff', side: 'right' });
  });
});
