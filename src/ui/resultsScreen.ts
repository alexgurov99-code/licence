import { keyLabel } from '../input/keymap';
import type { DriveResults, ResultItem } from '../rules/results';
import { SEVERITY_LABELS } from './faultFeed';
import { ResultsMap, type ResultsMapData } from './resultsMap';

// The results screen at the end of a drive: passed or failed and why, every fault with how it
// should have been done, and the map with the faults marked. Pointing at a fault in the list
// lights up its mark on the map, and the other way round.

export interface ResultsActions {
  retry: () => void;
  newRoute: () => void;
}

export class ResultsScreen {
  private readonly root: HTMLDivElement;
  private readonly verdict: HTMLDivElement;
  private readonly reason: HTMLDivElement;
  private readonly facts: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly map = new ResultsMap();
  private rows = new Map<number, HTMLLIElement>();
  private open = false;

  constructor(parent: HTMLElement, actions: ResultsActions) {
    this.root = document.createElement('div');
    this.root.className = 'results';
    this.root.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'results-panel';

    const side = document.createElement('div');
    side.className = 'results-side';
    this.verdict = document.createElement('div');
    this.verdict.className = 'results-verdict';
    this.reason = document.createElement('div');
    this.reason.className = 'results-reason';
    this.facts = document.createElement('div');
    this.facts.className = 'results-facts';
    this.list = document.createElement('ol');
    this.list.className = 'results-list';
    const buttons = document.createElement('div');
    buttons.className = 'results-buttons';
    buttons.append(
      button(`Repeat this route (${keyLabel('retry')})`, actions.retry),
      button(`New route (${keyLabel('newMap')})`, actions.newRoute),
    );
    side.append(this.verdict, this.reason, this.facts, this.list, buttons);

    const mapBox = document.createElement('div');
    mapBox.className = 'results-map-box';
    const legend = document.createElement('div');
    legend.className = 'results-legend';
    legend.innerHTML =
      '<span class="route">route</span><span class="trail">where you drove</span>' +
      '<span class="start">start</span><span class="mark immediateFail">fail</span>' +
      '<span class="mark critical">critical</span><span class="mark minor">minor</span>';
    mapBox.append(this.map.canvas, legend);
    panel.append(side, mapBox);
    this.root.appendChild(panel);
    parent.appendChild(this.root);

    this.map.canvas.addEventListener('mousemove', (event) => {
      const number = this.map.markAt(event.offsetX, event.offsetY);
      this.light(number);
      if (number !== null) this.rows.get(number)?.scrollIntoView({ block: 'nearest' });
    });
    this.map.canvas.addEventListener('mouseleave', () => this.light(null));
    window.addEventListener('resize', () => {
      if (this.open) this.map.draw();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(results: DriveResults, map: Omit<ResultsMapData, 'items'>, seed: string): void {
    this.verdict.textContent = results.passed ? 'PASSED' : 'FAILED';
    this.verdict.className = `results-verdict ${results.passed ? 'passed' : 'failed'}`;
    this.reason.textContent = results.endedEarly ? `The examiner ended the test. ${results.reason}` : results.reason;
    this.facts.textContent = `${results.counts}\nDrive ${results.drive} · seed ${seed}`;

    this.list.replaceChildren();
    this.rows = new Map();
    for (const item of results.items) {
      const row = faultRow(item);
      row.addEventListener('mouseenter', () => this.light(item.number));
      row.addEventListener('mouseleave', () => this.light(null));
      this.rows.set(item.number, row);
      this.list.appendChild(row);
    }
    if (results.items.length === 0) {
      const none = document.createElement('li');
      none.className = 'results-none';
      none.textContent = 'No faults. Well driven!';
      this.list.appendChild(none);
    }

    this.map.setData({ ...map, items: results.items });
    this.root.hidden = false;
    this.open = true;
    this.list.scrollTop = 0;
    this.map.draw();
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
  }

  private light(number: number | null): void {
    for (const [n, row] of this.rows) row.classList.toggle('lit', n === number);
    this.map.highlight(number);
  }
}

function faultRow(item: ResultItem): HTMLLIElement {
  const row = document.createElement('li');
  row.className = `results-fault ${item.fault.severity}`;
  const number = document.createElement('span');
  number.className = 'results-number';
  number.textContent = String(item.number);
  const text = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'results-fault-head';
  const level = document.createElement('strong');
  level.textContent = SEVERITY_LABELS[item.fault.severity];
  head.append(level, ` · ${item.place} · ${item.clock}`);
  const what = document.createElement('div');
  what.textContent = item.fault.what;
  const correct = document.createElement('small');
  correct.textContent = item.fault.correct;
  text.append(head, what, correct);
  row.append(number, text);
  return row;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', () => {
    element.blur();
    onClick();
  });
  return element;
}
