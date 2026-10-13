import { CONFIG } from '../config';
import type { Fault, Severity } from '../rules/types';

// Faults as they happen, in the top-right corner: the level and what happened. They fade after a
// few seconds; the full list with the right way to do it comes on the results screen (stage 7).

export const SEVERITY_LABELS: Record<Severity, string> = {
  immediateFail: 'Immediate fail',
  critical: 'Critical',
  minor: 'Minor',
};

export class FaultFeed {
  private readonly element: HTMLDivElement;
  private readonly items: { element: HTMLDivElement; remaining: number }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly seconds: number = CONFIG.ui.faultSeconds,
    private readonly shown: number = CONFIG.ui.faultsShown,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'fault-feed';
    parent.appendChild(this.element);
  }

  /** `advice`: also say how it should have been done (learner mode). */
  show(fault: Fault, advice = false): void {
    const item = document.createElement('div');
    item.className = `fault-item ${fault.severity}`;
    const label = document.createElement('strong');
    label.textContent = SEVERITY_LABELS[fault.severity];
    item.append(label, ` ${fault.what}`);
    if (advice) {
      const correct = document.createElement('small');
      correct.textContent = fault.correct;
      item.appendChild(correct);
    }
    this.element.appendChild(item);
    this.items.push({ element: item, remaining: this.seconds });
    while (this.items.length > this.shown) this.items.shift()?.element.remove();
  }

  /** Removes everything (a new map). */
  clear(): void {
    for (const item of this.items) item.element.remove();
    this.items.length = 0;
  }

  update(frameSeconds: number): void {
    for (const item of [...this.items]) {
      item.remaining -= frameSeconds;
      if (item.remaining <= 0) {
        item.element.remove();
        this.items.splice(this.items.indexOf(item), 1);
      }
    }
  }
}
