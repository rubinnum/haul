// PROTOTYPE. Throwaway content script for issue #9 (Stub injection on the
// transfers page). Four variants of the three injected blocks (fixture run,
// recent points, expected panel; see GLOSSARY.md) on the transfers pitch view
// and the Player Selection list, switchable from a floating bar or `?haul=A`.
// Fake values only. No data fetching, no persistence beyond sessionStorage
// for the chosen variant. Nothing here is meant to survive into the real build.

// ---------- variants ----------

type VariantKey = 'A' | 'B' | 'C' | 'D';
const VARIANTS: { key: VariantKey; name: string }[] = [
  { key: 'A', name: 'Stacked below the card' },
  { key: 'B', name: 'Flanks: points left, expected right' },
  { key: 'C', name: 'Flanks: expected left, points right' },
  { key: 'D', name: 'Compact strip, hover for detail' },
];

type FixtureStyle = 'ha' | 'case' | 'plain';
const FIXTURE_STYLES: { key: FixtureStyle; name: string }[] = [
  { key: 'ha', name: 'ARS (H)' },
  { key: 'case', name: 'ARS / ars' },
  { key: 'plain', name: 'ARS' },
];

const INFO_BTN = 'button[aria-label="View player information"]'; // Player Selection list rows
const PITCH_BTN = 'button[data-pitch-element="true"]'; // squad cards on the pitch
const KEEPER_SHIRT = /shirt_\d+_1-/; // FPL serves `shirt_<team>_1` for goalkeeper kits
const MARK = 'data-haul-proto';
const CLS = 'haul-proto';

// ---------- fake data ----------

const TEAMS = ['ARS', 'AVL', 'BOU', 'BRE', 'BHA', 'BUR', 'CHE', 'CRY', 'EVE', 'FUL', 'LEE', 'LIV', 'MCI', 'MUN', 'NEW', 'NFO', 'SUN', 'TOT', 'WHU', 'WOL'];
const FDR_COLORS: Record<number, [string, string]> = {
  1: ['#375523', '#fff'],
  2: ['#01fc7a', '#000'],
  3: ['#e7e7e7', '#000'],
  4: ['#ff1751', '#fff'],
  5: ['#80072d', '#fff'],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

interface Fixture { gw: number; opp: string; home: boolean; fdr: number }
interface GwPoints { gw: number; pts: number[] | null } // null = blank, 2 entries = double
interface Fake {
  name: string;
  isKeeper: boolean;
  fixtures: Fixture[];
  points: GwPoints[];
  xg: number; xa: number; xp: number; cs: number;
}

function fakeFor(name: string, isKeeper: boolean): Fake {
  const r = rng(hash(name));
  const nextGw = 12;
  const fixtures: Fixture[] = Array.from({ length: 5 }, (_, i) => ({
    gw: nextGw + i,
    opp: TEAMS[Math.floor(r() * TEAMS.length)]!,
    home: r() > 0.5,
    fdr: 1 + Math.floor(r() * 5),
  }));
  const points: GwPoints[] = Array.from({ length: 5 }, (_, i) => {
    const roll = r();
    if (roll < 0.1) return { gw: nextGw - 5 + i, pts: null };
    if (roll < 0.2) return { gw: nextGw - 5 + i, pts: [Math.floor(r() * 9), Math.floor(r() * 12)] };
    return { gw: nextGw - 5 + i, pts: [Math.floor(r() * 16)] };
  });
  return {
    name, isKeeper, fixtures, points,
    xg: +(r() * 0.8).toFixed(2),
    xa: +(r() * 0.5).toFixed(2),
    xp: +(2 + r() * 5).toFixed(1),
    cs: Math.round(20 + r() * 50),
  };
}

// ---------- state ----------

type RowMode = 'row' | 'inline' | 'off';
const ROW_MODES: { key: RowMode; name: string }[] = [
  { key: 'row', name: 'rows: extra line' },
  { key: 'inline', name: 'rows: compact' },
  { key: 'off', name: 'rows: off' },
];

interface State { variant: VariantKey; fixtureStyle: FixtureStyle; rowMode: RowMode }

function readState(): State {
  const url = new URL(location.href);
  const v = (url.searchParams.get('haul') || sessionStorage.getItem('haul-proto-variant') || 'A').toUpperCase();
  const f = (url.searchParams.get('haulfx') || sessionStorage.getItem('haul-proto-fx') || 'ha');
  const r = (url.searchParams.get('haulrows') || sessionStorage.getItem('haul-proto-rows') || 'row');
  return {
    variant: (VARIANTS.some((x) => x.key === v) ? v : 'A') as VariantKey,
    fixtureStyle: (FIXTURE_STYLES.some((x) => x.key === f) ? f : 'ha') as FixtureStyle,
    rowMode: (ROW_MODES.some((x) => x.key === r) ? r : 'row') as RowMode,
  };
}
function writeState(s: State) {
  sessionStorage.setItem('haul-proto-variant', s.variant);
  sessionStorage.setItem('haul-proto-fx', s.fixtureStyle);
  sessionStorage.setItem('haul-proto-rows', s.rowMode);
  const url = new URL(location.href);
  url.searchParams.set('haul', s.variant);
  url.searchParams.set('haulfx', s.fixtureStyle);
  url.searchParams.set('haulrows', s.rowMode);
  history.replaceState(history.state, '', url.toString());
}

const stats = { cards: 0, rows: 0, injections: 0, reinjections: 0, runs: 0 };
const seenRoots = new WeakSet<Element>();

// ---------- block renderers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = `${CLS} ${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fixtureLabel(f: Fixture, style: FixtureStyle): string {
  if (style === 'ha') return `${f.opp} (${f.home ? 'H' : 'A'})`;
  if (style === 'case') return f.home ? f.opp : f.opp.toLowerCase();
  return f.opp;
}

function renderFixtureRun(d: Fake, style: FixtureStyle, size: 'full' | 'mini'): HTMLElement {
  const wrap = el('div', `hp-fixtures hp-${size}`);
  for (const f of d.fixtures) {
    const [bg, fg] = FDR_COLORS[f.fdr]!;
    const chip = el('span', 'hp-fdr', size === 'full' ? fixtureLabel(f, style) : '');
    chip.style.background = bg;
    chip.style.color = fg;
    chip.title = `GW${f.gw}: ${f.opp} ${f.home ? '(H)' : '(A)'}, FDR ${f.fdr}`;
    wrap.append(chip);
  }
  return wrap;
}

function renderRecentPoints(d: Fake, dir: 'row' | 'col'): HTMLElement {
  const wrap = el('div', `hp-points hp-${dir}`);
  for (const p of d.points) {
    const label = p.pts === null ? '—' : p.pts.length === 2 ? String(p.pts[0]! + p.pts[1]!) : String(p.pts[0]);
    const cell = el('span', 'hp-pt', label);
    cell.title = p.pts === null
      ? `GW${p.gw}: blank`
      : p.pts.length === 2
        ? `GW${p.gw}: double, ${p.pts[0]} + ${p.pts[1]}`
        : `GW${p.gw}: ${p.pts[0]} pts`;
    if (p.pts && p.pts.length === 2) cell.classList.add('hp-dgw');
    if (p.pts === null) cell.classList.add('hp-blank');
    wrap.append(cell);
  }
  return wrap;
}

function renderExpected(d: Fake, dir: 'row' | 'col'): HTMLElement {
  const wrap = el('div', `hp-expected hp-${dir}`);
  const pairs: [string, string][] = d.isKeeper
    ? [['CS', `${d.cs}%`], ['xP', d.xp.toFixed(1)]]
    : [['xG', d.xg.toFixed(2)], ['xA', d.xa.toFixed(2)], ['xP', d.xp.toFixed(1)]];
  for (const [k, v] of pairs) {
    const item = el('span', 'hp-x');
    item.append(el('span', 'hp-xk', k), el('span', 'hp-xv', v));
    wrap.append(item);
  }
  return wrap;
}

// ---------- mounting ----------

// Verified against a logged-in DOM dump of /en/transfers (2026-11-21):
//  pitch:  div (slot) > div (wrapper) > button[data-pitch-element] {price, shirt <picture>, name, [data-fixture-bar] label}
//                                     + div {button[aria-label^="Remove player "]}
//  list:   table[aria-label=Goalkeepers|Defenders|Midfielders|Forwards] > tbody > tr
//            > td {button[aria-label="View player information"]} > th[scope=row] {shirt, "Name, Team" hidden span, name} > td price > td TP > td actions

function isKeeper(root: Element): boolean {
  const img = root.querySelector('img[src*="/shirts/"]') as HTMLImageElement | null;
  return !!img && KEEPER_SHIRT.test(img.getAttribute('src') || '');
}

function seedFor(root: Element, fallback: string): string {
  const hidden = root.querySelector('[class*="_visuallyHidden"]')?.textContent?.trim();
  const text = (hidden || root.textContent || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function clearOurs(root: Element) {
  root.querySelectorAll(`.${CLS}`).forEach((n) => n.remove());
  (root as HTMLElement).classList.remove('hp-host', 'hp-host-flank');
  if (root.tagName === 'TR') {
    const next = root.nextElementSibling;
    if (next && next.classList.contains(CLS)) next.remove();
  }
}

function mountCard(root: HTMLElement, d: Fake, s: State) {
  root.classList.add('hp-host');
  // The slot and wrapper come with whatever overflow the site sets; make sure our additions show.
  root.style.overflow = 'visible';
  if (root.parentElement) root.parentElement.style.overflow = 'visible';
  if (s.variant === 'A') {
    const box = el('div', 'hp-box hp-stack');
    const line = el('div', 'hp-line');
    line.append(renderRecentPoints(d, 'row'), renderExpected(d, 'row'));
    box.append(renderFixtureRun(d, s.fixtureStyle, 'full'), line);
    root.append(box);
  } else if (s.variant === 'B' || s.variant === 'C') {
    root.classList.add('hp-host-flank');
    const left = el('div', 'hp-flank hp-left');
    const right = el('div', 'hp-flank hp-right');
    const pts = renderRecentPoints(d, 'col');
    const xp = renderExpected(d, 'col');
    if (s.variant === 'B') { left.append(pts); right.append(xp); } else { left.append(xp); right.append(pts); }
    const below = el('div', 'hp-box hp-stack');
    below.append(renderFixtureRun(d, s.fixtureStyle, 'full'));
    root.append(left, right, below);
  } else {
    const strip = el('div', 'hp-box hp-compact');
    const ptsText = d.points.map((p) => (p.pts === null ? '—' : p.pts.reduce((a, b) => a + b, 0))).join('·');
    strip.append(renderFixtureRun(d, s.fixtureStyle, 'mini'), el('span', 'hp-mini-pts', ptsText), el('span', 'hp-mini-xp', `xP ${d.xp.toFixed(1)}`));
    const pop = el('div', 'hp-pop');
    pop.append(renderFixtureRun(d, s.fixtureStyle, 'full'), renderRecentPoints(d, 'row'), renderExpected(d, 'row'));
    root.append(strip, pop);
  }
}

function mountRow(tr: HTMLTableRowElement, d: Fake, s: State) {
  tr.classList.add('hp-host');
  if (s.rowMode === 'row') {
    // A full-width line under the player row.
    const extra = el('tr', 'hp-extra-row');
    const td = el('td', 'hp-extra-cell');
    td.colSpan = tr.children.length;
    const strip = el('div', 'hp-rowstrip');
    strip.append(renderFixtureRun(d, s.fixtureStyle, 'full'), renderRecentPoints(d, 'row'), renderExpected(d, 'row'));
    td.append(strip);
    extra.append(td);
    tr.after(extra);
  } else {
    // One compact line under the name, inside the player cell; hover for the full blocks.
    const cell = (tr.querySelector('th[scope="row"]') as HTMLElement | null) || tr;
    cell.classList.add('hp-host');
    const strip = el('div', 'hp-rowstrip hp-compact');
    strip.append(renderFixtureRun(d, s.fixtureStyle, 'mini'), el('span', 'hp-mini-xp', `xP ${d.xp.toFixed(1)}`));
    const pop = el('div', 'hp-pop hp-pop-row');
    pop.append(renderFixtureRun(d, s.fixtureStyle, 'full'), renderRecentPoints(d, 'row'), renderExpected(d, 'row'));
    cell.append(strip, pop);
  }
}

function onInjectablePage(): boolean {
  return /\/(transfers|my-team)(\/|$)/.test(location.pathname);
}

function removeOrphanRows() {
  document.querySelectorAll(`tr.${CLS}`).forEach((tr) => {
    const prev = tr.previousElementSibling;
    if (!prev || !prev.hasAttribute(MARK)) tr.remove();
  });
}

function injectAll(s: State) {
  stats.runs++;
  if (!onInjectablePage()) { stats.cards = 0; stats.rows = 0; updateBar(); return; }
  const stamp = `${s.variant}-${s.fixtureStyle}-${s.rowMode}`;
  removeOrphanRows();

  const cardRoots: HTMLElement[] = [];
  document.querySelectorAll(PITCH_BTN).forEach((btn) => { if (btn.parentElement) cardRoots.push(btn.parentElement); });
  const rowRoots: HTMLTableRowElement[] = [];
  document.querySelectorAll(INFO_BTN).forEach((btn) => { const tr = btn.closest('tr'); if (tr) rowRoots.push(tr); });

  const handle = (root: HTMLElement, mount: () => void) => {
    if (root.getAttribute(MARK) === stamp && (root.querySelector(`.${CLS}`) || (root.tagName === 'TR' && root.nextElementSibling?.classList.contains(CLS)))) return;
    if (seenRoots.has(root) && root.getAttribute(MARK) === stamp) stats.reinjections++; // React wiped our nodes
    clearOurs(root);
    root.setAttribute(MARK, stamp);
    seenRoots.add(root);
    mount();
    stats.injections++;
  };

  cardRoots.forEach((root, i) => handle(root, () => mountCard(root, fakeFor(seedFor(root, `card-${i}`), isKeeper(root)), s)));
  if (s.rowMode !== 'off') {
    rowRoots.forEach((tr, i) => handle(tr, () => mountRow(tr, fakeFor(seedFor(tr, `row-${i}`), isKeeper(tr)), s)));
  } else {
    rowRoots.forEach((tr) => { if (tr.hasAttribute(MARK)) { clearOurs(tr); tr.removeAttribute(MARK); } });
  }
  stats.cards = cardRoots.length; stats.rows = rowRoots.length;
  updateBar();
}

// ---------- floating bar ----------

let bar: HTMLElement | null = null;
let statsEl: HTMLElement | null = null;
let variantEl: HTMLElement | null = null;
let fxEl: HTMLElement | null = null;
let rowsEl: HTMLElement | null = null;

function buildBar(s: State, onChange: (s: State) => void) {
  bar = el('div', 'hp-bar');
  bar.setAttribute('data-haul-bar', '');
  const btn = (label: string, title: string, fn: () => void) => {
    const b = el('button', 'hp-btn', label); b.title = title; b.type = 'button';
    b.addEventListener('click', fn); return b;
  };
  const cycle = (dir: 1 | -1) => {
    const i = VARIANTS.findIndex((v) => v.key === s.variant);
    s.variant = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length]!.key;
    onChange(s);
  };
  const cycleFx = () => {
    const i = FIXTURE_STYLES.findIndex((v) => v.key === s.fixtureStyle);
    s.fixtureStyle = FIXTURE_STYLES[(i + 1) % FIXTURE_STYLES.length]!.key;
    onChange(s);
  };
  const cycleRows = () => {
    const i = ROW_MODES.findIndex((v) => v.key === s.rowMode);
    s.rowMode = ROW_MODES[(i + 1) % ROW_MODES.length]!.key;
    onChange(s);
  };
  variantEl = el('span', 'hp-label');
  fxEl = el('span', 'hp-label hp-fx');
  rowsEl = el('span', 'hp-label hp-fx');
  statsEl = el('span', 'hp-stats');
  bar.append(
    el('span', 'hp-tag', 'haul proto'),
    btn('◀', 'Previous variant (←)', () => cycle(-1)),
    variantEl,
    btn('▶', 'Next variant (→)', () => cycle(1)),
    el('span', 'hp-sep', '|'),
    btn('fixtures', 'Cycle how home/away shows in the fixture run', cycleFx),
    fxEl,
    el('span', 'hp-sep', '|'),
    btn('rows', 'Cycle how Player Selection rows are treated', cycleRows),
    rowsEl,
    el('span', 'hp-sep', '|'),
    statsEl,
    el('span', 'hp-sep', '|'),
    btn('dump DOM', 'Download the current #root markup (our nodes stripped) as an .html file', dumpDom),
    btn('copy DOM', 'Copy the same markup to the clipboard', copyDom),
  );
  document.body.append(bar);
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') cycle(-1);
    if (e.key === 'ArrowRight') cycle(1);
  });
  updateBar(s);
}

let lastState: State | null = null;
function updateBar(s?: State) {
  if (s) lastState = s;
  if (!lastState || !variantEl || !fxEl || !rowsEl || !statsEl) return;
  const v = VARIANTS.find((x) => x.key === lastState!.variant)!;
  const f = FIXTURE_STYLES.find((x) => x.key === lastState!.fixtureStyle)!;
  variantEl.textContent = `${v.key} · ${v.name}`;
  fxEl.textContent = f.name;
  rowsEl.textContent = ROW_MODES.find((x) => x.key === lastState!.rowMode)!.name;
  statsEl.textContent = onInjectablePage()
    ? `pitch ${stats.cards} · rows ${stats.rows} · inj ${stats.injections} · re-inj ${stats.reinjections} · runs ${stats.runs}`
    : `not a transfers/pick-team page · ${stats.runs} runs`;
}

function snapshotHtml(): string {
  const root = document.getElementById('root');
  if (!root) return '<!-- no #root -->';
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${CLS}, [data-haul-bar]`).forEach((n) => n.remove());
  clone.querySelectorAll(`[${MARK}]`).forEach((n) => { n.removeAttribute(MARK); n.classList.remove('hp-host', 'hp-host-flank'); });
  const head = `<!-- haul prototype DOM dump\n     url: ${location.href}\n     time: ${new Date().toISOString()}\n     title: ${document.title}\n     lang: ${document.documentElement.lang}\n     info buttons: ${document.querySelectorAll(INFO_BTN).length}\n-->\n`;
  return head + clone.outerHTML;
}
function dumpDom() {
  const blob = new Blob([snapshotHtml()], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const page = location.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  a.download = `haul-dom-${page}-${Date.now()}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function copyDom() {
  navigator.clipboard.writeText(snapshotHtml()).then(
    () => flash('copied'),
    () => flash('copy failed, use dump'),
  );
}
function flash(msg: string) {
  if (!statsEl) return;
  const prev = statsEl.textContent;
  statsEl.textContent = msg;
  setTimeout(() => { if (statsEl && statsEl.textContent === msg) statsEl.textContent = prev; }, 1500);
}

// ---------- styles ----------

const CSS = `
.${CLS} { box-sizing: border-box; font-family: system-ui, sans-serif; font-size: 10px; line-height: 1.2; color: #222; }
.hp-host { position: relative; }
.hp-box { margin-top: 2px; display: flex; flex-direction: column; gap: 2px; align-items: center; }
.hp-line { display: flex; gap: 4px; align-items: center; justify-content: center; flex-wrap: wrap; }
.hp-fixtures { display: flex; gap: 1px; }
.hp-fdr { display: inline-block; min-width: 14px; padding: 1px 2px; border-radius: 2px; font-size: 8px; font-weight: 600; text-align: center; white-space: nowrap; }
.hp-fixtures.hp-mini .hp-fdr { width: 8px; height: 8px; min-width: 0; padding: 0; border-radius: 1px; }
.hp-points { display: flex; gap: 1px; }
.hp-points.hp-col { flex-direction: column; }
.hp-pt { display: inline-block; min-width: 14px; padding: 1px 2px; border-radius: 2px; background: #e8e8f0; text-align: center; font-weight: 600; font-size: 9px; }
.hp-pt.hp-dgw { background: #c8f0d8; text-decoration: underline dotted; }
.hp-pt.hp-blank { color: #999; }
.hp-expected { display: flex; gap: 3px; }
.hp-expected.hp-col { flex-direction: column; gap: 1px; }
.hp-x { display: inline-flex; gap: 2px; align-items: baseline; background: #fff; border: 1px solid #ddd; border-radius: 2px; padding: 0 2px; }
.hp-xk { color: #666; font-size: 8px; }
.hp-xv { font-weight: 700; font-size: 9px; }
.hp-flank { position: absolute; top: 26px; display: flex; flex-direction: column; gap: 1px; z-index: 5; }
.hp-flank.hp-left { right: 100%; margin-right: 2px; align-items: flex-end; }
.hp-flank.hp-right { left: 100%; margin-left: 2px; align-items: flex-start; }
.hp-compact { flex-direction: row; gap: 4px; align-items: center; justify-content: center; }
.hp-mini-pts { font-size: 9px; letter-spacing: -0.2px; color: #333; }
.hp-mini-xp { font-size: 9px; font-weight: 700; }
.hp-pop { display: none; position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); z-index: 50; background: #fff; border: 1px solid #bbb; border-radius: 4px; padding: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.25); flex-direction: column; gap: 3px; align-items: center; }
.hp-host:hover > .hp-pop { display: flex; }
.hp-rowstrip { display: flex; gap: 8px; align-items: center; margin-top: 2px; flex-wrap: wrap; }
.hp-extra-row { background: rgba(255,255,255,.06); }
.hp-extra-cell { padding: 3px 8px 5px 44px !important; }
.hp-extra-cell .hp-fdr { font-size: 9px; min-width: 18px; }
.hp-extra-cell .hp-pt { font-size: 10px; min-width: 17px; }
.hp-extra-cell .hp-xv { font-size: 10px; }
.hp-pop-row { left: 0; transform: none; bottom: auto; top: 100%; }
.hp-host .hp-pop-row { display: none; }
.hp-host:hover > .hp-pop-row { display: flex; }
.hp-rowstrip.hp-compact { gap: 4px; }
.hp-bar { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 2147483647; display: flex; gap: 6px; align-items: center; background: #111; color: #fff; padding: 6px 10px; border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.4); font-size: 12px; white-space: nowrap; }
.hp-bar .hp-tag { color: #ffd166; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: .5px; }
.hp-bar .hp-btn { background: #333; color: #fff; border: 0; border-radius: 999px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.hp-bar .hp-btn:hover { background: #555; }
.hp-bar .hp-label { font-weight: 600; min-width: 150px; text-align: center; }
.hp-bar .hp-fx { min-width: 60px; font-weight: 400; color: #ddd; }
.hp-bar .hp-sep { color: #666; }
.hp-bar .hp-stats { color: #bbb; font-variant-numeric: tabular-nums; }
`;

// ---------- entry ----------

export default defineContentScript({
  matches: ['https://fantasy.premierleague.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const style = document.createElement('style');
    style.className = CLS; // stripped from dumps along with everything else of ours
    style.textContent = CSS;
    document.head.append(style);

    const state = readState();
    const rerender = (s: State) => {
      writeState(s);
      document.querySelectorAll(`[${MARK}]`).forEach((n) => { clearOurs(n); n.removeAttribute(MARK); });
      injectAll(s);
    };
    buildBar(state, rerender);
    injectAll(state);

    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; injectAll(state); });
    });
    const root = document.getElementById('root') || document.body;
    observer.observe(root, { childList: true, subtree: true });
    ctx.onInvalidated(() => { observer.disconnect(); bar?.remove(); style.remove(); });
    console.log('[haul-proto] content script ready', state);
  },
});
