import { describe, expect, it } from 'vitest';
import { COCKPIT_READY } from '../vehicle/cockpitTypes';
import { drive, faultList } from './testing';

const SEED = 'rules-0';

describe('cockpit drill', () => {
  it('moving off without the belt is a critical error, once', () => {
    const { faults } = drive(SEED, { belt: () => false });
    expect(faultList(faults)).toEqual(['drillOrder@-', 'noBelt@-']);
    expect(faults[1]?.severity).toBe('critical');
  });

  it('unfastening the belt while driving is a critical error too', () => {
    const { faults } = drive(SEED, { belt: (time) => time < 20 });
    expect(faultList(faults)).toEqual(['noBelt@-']);
  });

  it('moving off with the seat not adjusted is minor', () => {
    const { faults } = drive(SEED, { cockpit: { ...COCKPIT_READY, seat: false } });
    expect(faultList(faults)).toEqual(['drillOrder@-', 'seatNotAdjusted@-']);
    expect(faults.every((f) => f.severity === 'minor')).toBe(true);
  });

  it('mirrors not adjusted: one minor fault naming them', () => {
    const { faults } = drive(SEED, { cockpit: { ...COCKPIT_READY, interior: false, right: false } });
    expect(faultList(faults)).toEqual(['drillOrder@-', 'mirrorsNotAdjusted@-']);
    expect(faults[1]?.what).toContain('rear-view and right mirrors');
  });

  it('starting the engine before fastening the belt is out of order (minor)', () => {
    const { faults } = drive(SEED, { belt: (time) => time > 0.5 });
    expect(faultList(faults)).toEqual(['drillOrder@-']);
  });

  it('starting the engine after the drill is fine', () => {
    const { faults } = drive(SEED, { belt: (time) => time > 0.5, engineOnAt: 1 });
    expect(faultList(faults)).toEqual([]);
  });

  it('adjusting while parked is fine, while driving is minor (once per go)', () => {
    expect(faultList(drive(SEED, { adjusting: (time) => time < 3 }).faults)).toEqual([]);
    const { faults } = drive(SEED, { adjusting: (time) => (time > 10 && time < 12) || (time > 20 && time < 21) });
    expect(faultList(faults)).toEqual(['adjustedWhileMoving@-', 'adjustedWhileMoving@-']);
  });
});

describe('securing the car at the end', () => {
  it('handbrake and P after pulling over end the drive', () => {
    const result = drive(SEED);
    expect(result.rules.finished).toBe(true);
    expect(faultList(result.faults)).toEqual([]);
  });

  it('not securing the car is minor, and the drive then ends', () => {
    const result = drive(SEED, { park: false });
    const last = result.route.maneuvers.length - 1;
    expect(faultList(result.faults)).toEqual([`notSecured@${last}`]);
    expect(result.rules.finished).toBe(true);
  });
});
