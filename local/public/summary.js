'use strict';
// Classic light panels, with independently addressable cricket summary graphics.
(() => {
  const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
  const overs = balls => `${Math.floor(balls / 6)}.${balls % 6}`;
  const rate = (runs, balls) => balls ? (runs * 6 / balls).toFixed(2) : '—';
  const played = (b, index, inn) => index < inn.nextBat || b.runs || b.balls || b.out;
  const finished = (data, inn) => inn.ended || inn.wickets >= 10 || inn.legal >= data.config.maxOvers * 6 || (inn.target !== null && inn.total >= inn.target);
  const total = inn => inn.wickets === 10 ? `${inn.total} all out` : `${inn.total}/${inn.wickets}`;
  const dismissal = value => value.replace(/^bowled b /, 'b ').replace(/^caught \((.*?)\) b /, 'c $1 b ').replace(/^stumped \((.*?)\) b /, 'st $1 b ');
  function logo(appearance, home) {
    const src = appearance[home ? 'homeLogo' : 'awayLogo'];
    if (!src) return null;
    return createLogoMedia(src, 'summary-logo');
  }
  function table(headers, rows, className = '') {
    const t = node('table', undefined, `broadcast-table ${className}`), head = node('thead'), h = node('tr');
    headers.forEach(title => h.append(node('th', title))); head.append(h); t.append(head);
    const body = node('tbody');
    rows.forEach(row => {
      const r = node('tr');
      if (row.className) r.className = row.className;
      row.cells.forEach(cell => r.append(node('td', cell))); body.append(r);
    });
    t.append(body); return t;
  }
  function titleBlock(data, inn, title, bowling = false) {
    const header = node('header', undefined, 'summary-header'), copy = node('div', undefined, 'summary-heading'), side = bowling ? !inn.homeBatting : inn.homeBatting;
    const image = logo(data.appearance, side); if (image) header.append(image);
    copy.append(node('p', data.appearance.title || 'LIVE CRICKET', 'summary-kicker'), node('h1', title), node('p', `${bowling ? inn.bowling : inn.batting} · ${inn.number === 1 ? 'First' : 'Second'} innings`, 'summary-subtitle'));
    const score = node('div', undefined, 'summary-total'); score.append(node('span', bowling ? `${inn.batting} innings` : 'INNINGS TOTAL', 'total-label'), node('strong', total(inn)), node('span', `${overs(inn.legal)} overs · ${data.config.maxOvers} overs per side`));
    header.append(copy, score); return header;
  }
  function context(data, selected) {
    if (data.result) return data.result;
    const inn = selected || data.current;
    if (inn.target !== null) return `${inn.batting} need ${Math.max(0, inn.target - inn.total)} runs from ${Math.max(0, data.config.maxOvers * 6 - inn.legal)} balls · Target ${inn.target}`;
    return finished(data, inn) ? `${inn.batting} ${total(inn)} · ${inn.bowling} require ${inn.total + 1} to win` : `${inn.batting} innings in progress`;
  }
  function stat(label, value) { const box = node('div', undefined, 'summary-stat'); box.append(node('span', label), node('strong', value)); return box; }
  function stats(inn) { const strip = node('div', undefined, 'innings-stats'); strip.append(stat('OVERS', overs(inn.legal)), stat('RUN RATE', rate(inn.total, inn.legal)), stat('EXTRAS', inn.extras)); return strip; }
  function scorecard(data, inn, card) {
    card.append(titleBlock(data, inn, 'INNINGS SCORECARD'));
    const columns = node('div', undefined, 'scorecard-columns'), batting = node('section', undefined, 'batting-column'), bowling = node('section', undefined, 'bowling-column');
    batting.append(node('h2', 'BATTING'), table(['Batter', 'Dismissal', 'R', 'B', '4s', '6s', 'SR'], inn.batters.map((b, i) => {
      const hasBatted = played(b, i, inn);
      return {className: hasBatted ? !b.out ? 'not-out' : '' : 'yet-to-bat',
        cells: [b.name, b.out ? dismissal(b.out) : hasBatted ? 'not out' : finished(data, inn) ? 'did not bat' : 'yet to bat',
          ...(hasBatted ? [b.runs, b.balls, b.fours, b.sixes, b.balls ? (b.runs * 100 / b.balls).toFixed(1) : '—'] : ['—', '—', '—', '—', '—'])]};
    }), 'batting-table'));
    bowling.append(node('h2', `BOWLING · ${inn.bowling}`), bowlingTable(data, inn), stats(inn));
    columns.append(batting, bowling); card.append(columns);
    card.append(node('p', 'R Runs · B Balls faced · SR Strike rate', 'summary-legend'));
  }
  function bowlingTable(data, inn, full = false) {
    const bowlers = Object.values(inn.bowlers);
    const current = data.current.number === inn.number && !finished(data, inn) && !inn.awaitingBowler;
    return table(full ? ['Bowler', 'Overs', 'Maidens', 'Runs', 'Wickets', 'Econ'] : ['Bowler', 'O', 'M', 'R', 'W', 'Econ'], bowlers.length ? bowlers.map(b => ({className: current && b.name === inn.bowler ? 'current-bowler' : '', cells: [b.name, overs(b.legal), b.maidens, b.runs, b.wickets, rate(b.runs, b.legal)]})) : [{cells: ['No bowling figures yet', '—', '—', '—', '—', '—']}], 'bowling-table');
  }
  function bowling(data, inn, card) {
    card.append(titleBlock(data, inn, 'BOWLING ANALYSIS', true));
    const stats = node('div', undefined, 'bowling-context');
    stats.append(stat('BOWLING TEAM', inn.bowling), stat('BATTING TEAM', inn.batting), stat('RUN RATE', rate(inn.total, inn.legal)), stat('EXTRAS', inn.extras));
    card.append(stats, bowlingTable(data, inn, true), node('p', 'Figures in bowling order · Econ: runs conceded per over', 'summary-legend'));
  }
  function leaders(inn) {
    const list = node('div', undefined, 'summary-leaders');
    list.append(node('h3', `BATTING · ${inn.batting}`));
    const batters = inn.batters.filter((b, i) => played(b, i, inn)).slice().sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 3);
    batters.forEach(b => { const row = node('div'); row.append(node('span', b.name), node('strong', `${b.runs}${b.out ? '' : '*'} (${b.balls})`)); list.append(row); });
    list.append(node('h3', `BOWLING · ${inn.bowling}`));
    const bowlers = Object.values(inn.bowlers).slice().sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, 3);
    if (!bowlers.length) list.append(node('p', 'No bowling figures yet', 'summary-muted'));
    bowlers.forEach(b => { const row = node('div'); row.append(node('span', b.name), node('strong', `${b.wickets}/${b.runs} (${overs(b.legal)})`)); list.append(row); });
    return list;
  }
  function match(data, card) {
    const header = node('header', undefined, 'summary-header'), copy = node('div', undefined, 'summary-heading');
    copy.append(node('p', data.appearance.title || 'LIVE CRICKET', 'summary-kicker'), node('h1', 'MATCH SUMMARY'), node('p', `${data.config.home} v ${data.config.away}`, 'summary-subtitle'));
    const badge = node('div', undefined, 'match-status'); badge.append(node('strong', data.matchOver ? 'RESULT' : data.innings.length === 1 && data.inningsComplete ? 'INNINGS BREAK' : 'LIVE'), node('span', `${data.config.maxOvers} OVERS PER SIDE`));
    header.append(copy, badge); card.append(header);
    const columns = node('div', undefined, 'match-columns');
    for (let i = 0; i < 2; i++) {
      const inn = data.innings[i], panel = node('section', undefined, 'match-innings');
      if (!inn) {
        const home = !data.innings[0].homeBatting;
        panel.style.setProperty('--innings-colour', home ? data.appearance.homeColour : data.appearance.awayColour);
        panel.append(node('p', 'SECOND INNINGS', 'summary-kicker'));
        const name = node('div', undefined, 'match-team'), image = logo(data.appearance, home); if (image) name.append(image); name.append(node('h2', home ? data.config.home : data.config.away));
        panel.append(name, node('p', 'YET TO BAT', 'summary-waiting'), node('p', data.inningsComplete ? `Target ${data.innings[0].total + 1}` : 'First innings in progress', 'summary-subtitle')); columns.append(panel); continue;
      }
      panel.style.setProperty('--innings-colour', inn.homeBatting ? data.appearance.homeColour : data.appearance.awayColour);
      const name = node('div', undefined, 'match-team'), image = logo(data.appearance, inn.homeBatting); if (image) name.append(image); name.append(node('h2', inn.batting));
      const score = node('div', undefined, 'match-total'); score.append(node('strong', total(inn)), node('span', `${overs(inn.legal)} overs`));
      panel.append(node('p', i === 0 ? 'FIRST INNINGS' : 'SECOND INNINGS', 'summary-kicker'), name, score, stats(inn), leaders(inn)); columns.append(panel);
    }
    card.append(columns, node('p', 'Leading performers · Batting: runs (balls) · Bowling: wickets/runs (overs) · * Not out', 'summary-legend'));
  }
  globalThis.renderSummary = (data, mode, selected) => {
    const root = document.getElementById('summary-graphic');
    root.hidden = !data.active || !['scorecard', 'match', 'bowling'].includes(mode);
    if (root.hidden) return;
    const key = `${data.revision}:${mode}:${selected}`;
    if (root.dataset.frame === key) return;
    root.dataset.frame = key; root.dataset.mode = mode;
    root.style.setProperty('--summary-panel', data.appearance.panelColour); root.style.setProperty('--summary-text', data.appearance.textColour);
    const inn = selected === '1' || selected === '2' ? data.innings[Number(selected) - 1] : data.current;
    const side = inn ? mode === 'bowling' ? !inn.homeBatting : inn.homeBatting : true;
    root.style.setProperty('--summary-accent', side ? data.appearance.homeColour : data.appearance.awayColour);
    const card = node('article', undefined, 'summary-card');
    if (mode === 'bowling' && inn && Object.keys(inn.bowlers).length > 5) card.className += ' compact';
    if (mode === 'match') match(data, card);
    else if (!inn) { card.append(node('h1', 'SECOND INNINGS'), node('p', 'This innings has not started yet.', 'summary-waiting')); }
    else if (mode === 'scorecard') scorecard(data, inn, card);
    else bowling(data, inn, card);
    card.append(node('footer', context(data, mode === 'match' ? null : inn), 'summary-footer')); root.replaceChildren(card);
  };
})();
