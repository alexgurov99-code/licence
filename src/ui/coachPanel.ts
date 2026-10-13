import { CONFIG } from '../config';
import { GEAR_ACTIONS } from '../input/carInput';
import { keyLabel } from '../input/keymap';
import { ordinal } from '../route/instructions';
import type { Maneuver } from '../route/route';
import type { CoachStep, CoachStepState, CoachWarning, Coaching } from '../rules/coach';

// Learner mode panel at the top of the screen: the next manoeuvre, its steps with the keys to
// press (done ones ticked, the one to do now highlighted), and warnings. L switches it off for
// exam mode.

export interface CoachText {
  title: string;
  /** No steps yet (the manoeuvre is a way off or a bend comes first): shown small and dim. */
  quiet: boolean;
  steps: { text: string; state: CoachStepState }[];
  warnings: string[];
}

const MARKS: Record<CoachStepState, string> = { done: '✓', now: '▶', todo: '·', missed: '✗' };

export function coachText(coaching: Coaching): CoachText {
  const m = coaching.maneuver;
  const away = coaching.distance !== null && coaching.distance > CONFIG.minimap.nowDistance ? ` · ${Math.round(coaching.distance / 10) * 10} m` : '';
  const named = `${maneuverTitle(m, coaching)}${away}`;
  const title =
    coaching.phase === 'bend'
      ? `The road bends ${coaching.bend ?? ''}: just follow it, no signal. Then: ${named}`
      : coaching.phase === 'ahead'
        ? `Next: ${named}`
        : named;
  return {
    title,
    quiet: coaching.phase !== 'steps',
    steps: coaching.steps.map((step) => ({ text: stepText(step, m), state: step.state })),
    warnings: coaching.warnings.map(warningText),
  };
}

function maneuverTitle(m: Maneuver, coaching: Coaching): string {
  const sign = m.control === 'stop' ? ' (Stop sign)' : m.control === 'giveWay' ? ' (Give Way)' : '';
  switch (m.kind) {
    case 'pullOut':
      return 'Pull out from the kerb';
    case 'pullOver':
      return coaching.steps[0]?.kind === 'park' ? 'Parked: secure the car' : 'Pull over at the flag';
    case 'left':
      return `Turn left${sign}`;
    case 'right':
      return `Turn right${sign}`;
    case 'straight':
      return `Straight on${sign}`;
    case 'roundabout':
      return `Roundabout: ${ordinal(m.exit ?? 1)} exit`;
  }
}

function stepText(step: CoachStep, m: Maneuver): string {
  const k = keyLabel;
  const sideMirror = step.side === 'left' ? k('lookLeft') : k('lookRight');
  switch (step.kind) {
    case 'belt':
      return `Belt ${k('belt')}`;
    case 'engine':
      return `Engine: hold ${k('brake')}, press ${k('engine')}`;
    case 'mirror':
      return `Mirror ${k('lookUp')} or ${sideMirror}`;
    case 'signal': {
      const key = step.side === 'left' ? k('indicatorLeft') : k('indicatorRight');
      const timer =
        step.state === 'now' && step.seconds && step.needSeconds ? ` ${step.seconds.toFixed(1)} / ${step.needSeconds} s` : ` ${step.needSeconds ?? 3} s`;
      return `Indicate ${step.side} ${key}${step.state === 'done' ? '' : timer}`;
    }
    case 'shoulder':
      return `Right shoulder ${k('lookDown')}+${k('lookRight')}`;
    case 'moveOff':
      return `D ${k(GEAR_ACTIONS.D)}, handbrake off ${k('handbrake')}, go`;
    case 'stop':
      return 'Full stop at the line';
    case 'giveWay':
      return m.kind === 'roundabout'
        ? `Slow below ${CONFIG.rules.junction.giveWayKmh} km/h, give way to the right`
        : `Slow below ${CONFIG.rules.junction.giveWayKmh} km/h, look both ways`;
    case 'go':
      switch (m.kind) {
        case 'left':
          return 'Turn left';
        case 'right':
          return 'Turn right';
        case 'roundabout':
          return `Take the ${ordinal(m.exit ?? 1)} exit`;
        default:
          return 'Go straight on';
      }
    case 'exitSignal':
      return `Indicate left ${k('indicatorLeft')} after the exit before yours`;
    case 'cancelSignal':
      return `Indicator off: ${k('indicatorLeft')} / ${k('indicatorRight')} again`;
    case 'pullOver':
      return 'Stop by the kerb at the flag';
    case 'park':
      return `Handbrake ${k('handbrake')} and P ${k(GEAR_ACTIONS.P)}`;
  }
}

function warningText(warning: CoachWarning): string {
  return warning.kind === 'speeding' ? `Slow down: the limit is ${warning.limit} km/h` : 'Keep left in your lane';
}

export class CoachPanel {
  private readonly element: HTMLDivElement;
  private shown = '';

  constructor(private readonly container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'coach-panel';
    this.element.hidden = true;
    container.appendChild(this.element);
  }

  /** null hides the panel (exam mode, off the route). */
  update(coaching: Coaching | null): void {
    const text = coaching ? coachText(coaching) : null;
    const key = JSON.stringify(text);
    if (key === this.shown) return;
    this.shown = key;
    this.element.replaceChildren();
    this.element.hidden = !text;
    this.element.classList.toggle('quiet', !!text?.quiet);
    if (text) {
      const title = document.createElement('div');
      title.className = 'coach-title';
      title.textContent = text.title;
      const steps = document.createElement('div');
      steps.className = 'coach-steps';
      for (const step of text.steps) {
        const chip = document.createElement('span');
        chip.className = `coach-step ${step.state}`;
        chip.textContent = `${MARKS[step.state]} ${step.text}`;
        steps.appendChild(chip);
      }
      this.element.append(title);
      if (text.steps.length > 0) this.element.append(steps);
      for (const warning of text.warnings) {
        const line = document.createElement('div');
        line.className = 'coach-warning';
        line.textContent = warning;
        this.element.appendChild(line);
      }
    }
    // Messages show below the panel.
    const height = text ? this.element.offsetHeight + 8 : 0;
    this.container.style.setProperty('--coach-height', `${height}px`);
  }
}
