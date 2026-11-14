'use strict';
const $ = id => document.getElementById(id);
const preview = new URLSearchParams(location.search).has('preview');
const overs = balls => `${Math.floor(balls / 6)}.${balls % 6}`;
let initialized = false, lastBallKey = '', lastBallCount = 0, timer;
function span(text, className) { const el = document.createElement('span'); el.textContent = text; if (className) el.className = className; return el; }
function small(text) { const el = document.createElement('small'); el.textContent = text; return el; }
function team(id, name, logo) {
  const container = $(id), key = name + '|' + (logo || '');
  if (container.dataset.logoKey === key) return;
  container.dataset.logoKey = key; container.replaceChildren();
  if (logo) {
    const image = document.createElement('img'); image.className = 'team-logo'; image.alt = ''; image.src = logo;
    image.addEventListener('error', () => image.remove()); container.append(image);
  }
  container.append(span(name, 'team-name'));
}
function cornerLogo(slot, appearance) {
  const image = $(slot + '-corner-logo'), src = appearance[slot + 'Logo'] || '';
  if (image.dataset.source !== src) {
    image.dataset.source = src;
    if (src) image.src = src; else image.removeAttribute('src');
  }
  image.hidden = !src || appearance[slot + 'Visible'] === false;
  image.style.width = `${appearance[slot + 'LogoWidth']}px`;
  image.style.top = `${appearance[slot + 'LogoTop']}px`;
  image.style.maxHeight = `${540 - appearance[slot + 'LogoTop']}px`;
  image.style[slot === 'channel' ? 'left' : 'right'] = `${appearance[slot + 'LogoSide']}px`;
}
function render(data) {
  document.body.dataset.offline = 'false';
  const cfg = data.config || {home: 'Home CC', away: 'Away CC', homeAbbrev: 'HOME', awayAbbrev: 'AWAY', maxOvers: 20};
  const a = data.appearance;
  cornerLogo('channel', a); cornerLogo('sponsor', a);
  const inn = data.current || {homeBatting: true, total: 0, wickets: 0, legal: 0, number: 1,
    striker: 0, nonStriker: 1, batters: [{name: 'Opening batter', runs: 0, balls: 0}, {name: 'Opening batter', runs: 0, balls: 0}], bowlers: {}, bowler: '', thisOver: [], completedOvers: [], target: null};
  $('graphic').hidden = !a.visible || (!data.active && !preview);
  const g = $('graphic'); g.style.left = `${a.side}px`; g.style.width = `${1920 - a.side * 2}px`; g.style.bottom = `${a.bottom}px`; g.style.transform = `scale(${a.scale / 100})`;
  g.style.setProperty('--bat', inn.homeBatting ? a.homeColour : a.awayColour);
  g.style.setProperty('--bowl', inn.homeBatting ? a.awayColour : a.homeColour);
  g.style.setProperty('--panel', a.panelColour); g.style.setProperty('--text', a.textColour);
  g.style.setProperty('--team-logo-size', `${a.teamLogoSize || 56}px`);
  $('title').textContent = a.title;
  team('batting-team', inn.homeBatting ? cfg.homeAbbrev : cfg.awayAbbrev, inn.homeBatting ? a.homeLogo : a.awayLogo);
  team('bowling-team', inn.homeBatting ? cfg.awayAbbrev : cfg.homeAbbrev, inn.homeBatting ? a.awayLogo : a.homeLogo);
  $('total').textContent = `${inn.total}-${inn.wickets}`; $('innings').textContent = inn.number === 1 ? '1st' : '2nd';
  $('overs').replaceChildren(span(overs(inn.legal)), small(`(${cfg.maxOvers}) ov`));
  const rate = inn.legal ? (inn.total * 6 / inn.legal).toFixed(2) : '0.00';
  const ballsLeft = Math.max(0, cfg.maxOvers * 6 - inn.legal), need = inn.target === null ? null : Math.max(0, inn.target - inn.total);
  $('status').textContent = data.result || (data.inningsComplete ? 'INNINGS BREAK' : need !== null ? `TARGET ${inn.target} · NEED ${need} FROM ${ballsLeft} BALLS` : `CRR ${rate}`);
  [inn.striker, inn.nonStriker].forEach((index, i) => { const b = inn.batters[index]; $('batter' + (i + 1)).replaceChildren(span(i === 0 ? '▸' : '', 'strike'), span(b.name, 'name'), span(b.runs), small(`(${b.balls})`)); });
  const bw = inn.bowlers[inn.bowler];
  $('bowler').replaceChildren(span(bw ? bw.name : 'Select bowler', 'name'), small(bw ? `${overs(bw.legal)}-${bw.maidens}-${bw.runs}-${bw.wickets}` : 'Ready for the first ball'));
  const tokens = inn.thisOver.length ? inn.thisOver : inn.completedOvers.at(-1)?.tokens || [];
  $('over').hidden = !a.ticker;
  $('over').replaceChildren(small(inn.thisOver.length || !inn.legal ? 'THIS OVER' : 'LAST OVER'), ...tokens.slice(-8).map(t => span(t, 'ball ' + (t.includes('W') ? 'wicket' : t === '4' ? 'four' : t === '6' ? 'six' : /[a-z]/.test(t) ? 'extra' : ''))));
  const last = data.history.at(-1), key = last ? `${last.index}:${JSON.stringify(last.event)}` : '';
  if (data.history.length < lastBallCount) { clearTimeout(timer); $('moment').hidden = true; }
  if (initialized && a.flash && data.history.length > lastBallCount && key && key !== lastBallKey && !data.inningsComplete) {
    const ev = last.event, label = ev.kind === 'wicket' ? 'WICKET' : ev.kind === 'run' && ev.runs === 4 ? 'FOUR' : ev.kind === 'run' && ev.runs === 6 ? 'SIX' : '';
    if (label) { clearTimeout(timer); $('moment').replaceChildren(span(label)); if (label === 'WICKET' && inn.lastWicket) $('moment').append(small(`${inn.lastWicket.name} · ${inn.lastWicket.how}`)); $('moment').hidden = false; timer = setTimeout(() => $('moment').hidden = true, 4500); }
  }
  if (!a.visible || !a.flash) { clearTimeout(timer); $('moment').hidden = true; }
  initialized = true; lastBallKey = key; lastBallCount = data.history.length;
}
const events = new EventSource('/api/events');
events.onmessage = event => { try { render(JSON.parse(event.data)); } catch (error) { console.error('Overlay update failed:', error); } };
events.onerror = () => { document.body.dataset.offline = 'true'; };
