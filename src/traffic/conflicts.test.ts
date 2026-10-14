import { describe, expect, it } from 'vitest';
import { opposite, rightTurnOf } from '../world/layout';
import { buildNetwork, type Connector, type Junction } from '../world/network';
import { buildConflicts } from './conflicts';

const network = buildNetwork('conflicts');
const table = buildConflicts(network);

function junctionOf(kind: Junction['kind']): Junction {
  const found = network.junctions.find((j) => j.kind === kind && j.arms.length === (kind === 'tee' ? 3 : 4));
  if (!found) throw new Error(`No ${kind} in the test town`);
  return found;
}

function path(junction: Junction, armIndex: number, turn: Connector['turn']): Connector {
  const arm = junction.arms[armIndex];
  const found = network.connectors.find((c) => c.junctionId === junction.id && c.fromLane === arm?.inLane && c.turn === turn);
  if (!found) throw new Error('No such junction path');
  return found;
}

describe('where junction paths meet', () => {
  const cross = junctionOf('cross');
  const facing = cross.arms.findIndex((a) => a.dir === opposite(cross.arms[0]?.dir ?? 0));

  it('opposite straight paths keep to their own lanes and never meet', () => {
    expect(table.between(path(cross, 0, 'straight').id, path(cross, facing, 'straight').id)).toBeNull();
  });

  it('a right turn crosses the oncoming straight path', () => {
    const area = table.between(path(cross, 0, 'right').id, path(cross, facing, 'straight').id);
    expect(area).not.toBeNull();
    expect(area?.merge).toBe(false);
    // Seen from the other path the same place, the other way round.
    const back = table.between(path(cross, facing, 'straight').id, path(cross, 0, 'right').id);
    expect(back?.aFrom).toBe(area?.bFrom);
    expect(back?.bTo).toBe(area?.aTo);
  });

  it('two paths into the same lane merge', () => {
    const left = path(cross, 0, 'left');
    const into = network.connectors.find((c) => c.junctionId === cross.id && c.toLane === left.toLane && c.turn === 'straight');
    const area = into && table.between(left.id, into.id);
    expect(area?.merge).toBe(true);
    expect(area?.aTo).toBeCloseTo(left.path.length, 0);
  });

  it('paths from the same lane are not a conflict (the car ahead is just followed)', () => {
    expect(table.between(path(cross, 0, 'left').id, path(cross, 0, 'right').id)).toBeNull();
  });

  it('the give-way line is where the lane ends at T and cross junctions, on the way in at roundabouts', () => {
    expect(table.gate(path(cross, 0, 'straight').id)).toBe(0);
    const roundabout = junctionOf('roundabout');
    const entry = path(roundabout, 0, 'straight');
    expect(table.gate(entry.id)).toBeGreaterThan(1);
    expect(table.gate(entry.id)).toBeLessThan(entry.path.length / 2);
  });

  it('on a roundabout, a path from the arm to the right shares the circle with this one', () => {
    const roundabout = junctionOf('roundabout');
    const mine = path(roundabout, 0, 'straight');
    const upstream = roundabout.arms.findIndex((a) => a.dir === rightTurnOf(opposite(roundabout.arms[0]?.dir ?? 0)));
    const theirs = path(roundabout, upstream, 'right');
    const area = table.between(mine.id, theirs.id);
    expect(area?.merge).toBe(true);
  });
});
