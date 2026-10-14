// What the other traffic means for the learner, once per physics step: the cars whose way the
// learner's way meets at the junction ahead, who must give way there, who had to brake hard
// because of the learner, a collision, and the car ahead in the lane. Pure data: the traffic
// (traffic.ts) works it out, the rules engine and the learner-mode hints read it.

export type Direction = 'left' | 'right' | 'ahead' | 'behind';

/** Another car whose way through the junction meets the learner's. */
export interface TrafficConflict {
  carId: number;
  /** By the give way rules, the learner must give way to this car here. */
  learnerGivesWay: boolean;
  /** From the learner's front bumper to where the two ways meet (negative: already in it); whether the learner is through it. */
  learnerTo: number;
  learnerClear: boolean;
  /** The same for the other car, and its speed (m/s). */
  carTo: number;
  carClear: boolean;
  carSpeed: number;
  /** Where the car is, seen from the learner's seat. */
  from: Direction;
}

export interface TrafficView {
  conflicts: readonly TrafficConflict[];
  /** Cars that braked hard this step because of the learner ("evasive action"). */
  evasive: readonly number[];
  /** The learner's car touched another car this step. */
  collision: 'car' | 'parkedCar' | null;
  /** The nearest car ahead in the learner's lane: gap bumper to bumper (m) and its speed (m/s). */
  ahead: { carId: number; gap: number; speed: number } | null;
}

export const NO_TRAFFIC: TrafficView = { conflicts: [], evasive: [], collision: null, ahead: null };
