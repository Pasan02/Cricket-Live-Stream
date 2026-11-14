'use strict';

// Scoring rules adapted from CricketStream's original Go engine (GPL-3.0).
// See README.md for attribution. This runtime has no external dependencies.
const clone = value => structuredClone(value);
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function text(value, fallback = '') { return String(value ?? fallback).trim().slice(0, 64); }
function integer(value, min, max, label) {
  requireThat(Number.isInteger(value) && value >= min && value <= max, `${label} must be ${min}–${max}.`);
  return value;
}
function normalizeConfig(raw) {
  const home = text(raw.home, 'Home CC'), away = text(raw.away, 'Away CC');
  requireThat(home && away && home !== away, 'Enter two different team names.');
  const roster = (names, team) => {
    requireThat(Array.isArray(names) && names.length <= 11, 'Enter up to 11 players per team.');
    const list = names.map(n => text(n)).filter(Boolean);
    requireThat(new Set(list).size === list.length, 'Player names must be unique within each team.');
    while (list.length < 11) {
      let name = `${team.slice(0, 40)} ${list.length + 1}`;
      while (list.includes(name)) name += '*';
      list.push(name);
    }
    return list;
  };
  return {home, away, homeAbbrev: text(raw.homeAbbrev || home.slice(0, 6)).slice(0, 10),
    awayAbbrev: text(raw.awayAbbrev || away.slice(0, 6)).slice(0, 10),
    homeXI: roster(raw.homeXI || [], home), awayXI: roster(raw.awayXI || [], away),
    maxOvers: integer(raw.maxOvers ?? 20, 1, 120, 'Overs'), battingFirst: raw.battingFirst === 'away' ? 'away' : 'home'};
}
const defaults = () => ({title: 'LIVE CRICKET', homeColour: '#1a3a5c', awayColour: '#7b2d2d',
  panelColour: '#d0d4db', textColour: '#0d1520', scale: 100, bottom: 24, side: 24,
  visible: true, ticker: true, flash: true, homeLogo: '', awayLogo: '', teamLogoSize: 56,
  channelLogo: '', sponsorLogo: '', channelVisible: true, sponsorVisible: true,
  channelLogoWidth: 140, sponsorLogoWidth: 220, channelLogoTop: 40, sponsorLogoTop: 40,
  channelLogoSide: 40, sponsorLogoSide: 40, summaryType: 'none', summaryInnings: 'current'});
function normalizeAppearance(raw) {
  const out = {...defaults(), ...raw};
  for (const key of ['homeColour', 'awayColour', 'panelColour', 'textColour'])
    requireThat(/^#[0-9a-f]{6}$/i.test(out[key]), 'Choose a valid colour.');
  for (const key of ['visible', 'ticker', 'flash', 'channelVisible', 'sponsorVisible']) requireThat(typeof out[key] === 'boolean', 'Invalid display setting.');
  for (const key of ['homeLogo', 'awayLogo', 'channelLogo', 'sponsorLogo']) requireThat(typeof out[key] === 'string' && (out[key] === '' || /^\/logos\/[a-f0-9]{64}\.(png|mp4|webm)$/.test(out[key])), 'Invalid logo.');
  requireThat(['none', 'scorecard', 'match', 'bowling'].includes(out.summaryType), 'Choose a valid summary graphic.');
  requireThat(['current', '1', '2'].includes(out.summaryInnings), 'Choose the current, first or second innings.');
  return {title: text(out.title), homeColour: out.homeColour, awayColour: out.awayColour,
    panelColour: out.panelColour, textColour: out.textColour, scale: integer(out.scale, 60, 100, 'Scale'),
    bottom: integer(out.bottom, 0, 200, 'Bottom margin'), side: integer(out.side, 0, 200, 'Side margin'),
    visible: out.visible, ticker: out.ticker, flash: out.flash, homeLogo: out.homeLogo, awayLogo: out.awayLogo,
    teamLogoSize: integer(out.teamLogoSize, 32, 72, 'Team logo size'), channelLogo: out.channelLogo, sponsorLogo: out.sponsorLogo,
    channelVisible: out.channelVisible, sponsorVisible: out.sponsorVisible,
    channelLogoWidth: integer(out.channelLogoWidth, 60, 360, 'Channel logo width'), sponsorLogoWidth: integer(out.sponsorLogoWidth, 60, 360, 'Sponsor logo width'),
    channelLogoTop: integer(out.channelLogoTop, 0, 300, 'Channel top margin'), sponsorLogoTop: integer(out.sponsorLogoTop, 0, 300, 'Sponsor top margin'),
    channelLogoSide: integer(out.channelLogoSide, 0, 300, 'Channel side margin'), sponsorLogoSide: integer(out.sponsorLogoSide, 0, 300, 'Sponsor side margin'),
    summaryType: out.summaryType, summaryInnings: out.summaryInnings};
}
function newDocument() { return {format: 1, revision: 0, config: null, appearance: defaults(), events: [], requests: []}; }
const overs = balls => `${Math.floor(balls / 6)}.${balls % 6}`;
function newInnings(config, number, target) {
  const homeBatting = (config.battingFirst === 'home') === (number === 1);
  const bats = homeBatting ? config.homeXI : config.awayXI, fielders = homeBatting ? config.awayXI : config.homeXI;
  return {number, homeBatting, batting: homeBatting ? config.home : config.away,
    bowling: homeBatting ? config.away : config.home, target,
    total: 0, wickets: 0, legal: 0, extras: 0, striker: 0, nonStriker: 1, nextBat: 2,
    batters: bats.map(name => ({name, runs: 0, balls: 0, fours: 0, sixes: 0, out: ''})),
    fielders, bowlers: Object.create(null), bowler: '', awaitingBowler: true, ended: false,
    thisOver: [], completedOvers: [], overRuns: 0, overConceded: 0, overBowlers: [],
    partnershipRuns: 0, partnershipBalls: 0, lastWicket: null};
}
function complete(inn, cfg) {
  return inn.ended || inn.wickets >= 10 || inn.legal >= cfg.maxOvers * 6 || (inn.target !== null && inn.total >= inn.target);
}
function swap(inn) { [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker]; }
function delivery(inn, event, config) {
  requireThat(!complete(inn, config), 'This innings has ended.');
  requireThat(!inn.awaitingBowler && inn.bowler, 'Select the bowler before scoring.');
  const kind = event.kind;
  requireThat(['run', 'wide', 'noball', 'bye', 'legbye', 'wicket'].includes(kind), 'Unknown delivery.');
  const runs = integer(event.runs ?? 0, 0, 6, 'Runs');
  const legal = kind !== 'wide' && kind !== 'noball';
  const batter = inn.batters[inn.striker], bowler = inn.bowlers[inn.bowler];
  let teamRuns = 0, conceded = 0, crossed = 0, token;
  if (kind === 'wicket') {
    requireThat(['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket'].includes(event.dismissal), 'Choose a dismissal.');
    requireThat(event.dismissal === 'run out' || runs === 0, 'Only run outs can include completed runs here.');
    requireThat(!event.nonStriker || event.dismissal === 'run out', 'Only a run out can dismiss the non-striker.');
    const dismissed = event.nonStriker ? inn.nonStriker : inn.striker;
    teamRuns = conceded = runs;
    batter.runs += runs; batter.balls++;
    const fielder = text(event.fielder);
    const how = event.dismissal + (fielder ? ` (${fielder})` : '') + (event.dismissal !== 'run out' ? ` b ${inn.bowler}` : '');
    inn.batters[dismissed].out = how;
    inn.wickets++;
    if (event.dismissal !== 'run out') bowler.wickets++;
    inn.lastWicket = {name: inn.batters[dismissed].name, how};
    if (inn.nextBat < 11) {
      if (event.nonStriker) inn.nonStriker = inn.nextBat++; else inn.striker = inn.nextBat++;
    }
    crossed = runs; token = runs ? `${runs}W` : 'W';
    inn.partnershipRuns = 0; inn.partnershipBalls = 0;
  } else if (kind === 'wide') {
    teamRuns = conceded = 1 + runs; inn.extras += teamRuns; crossed = runs;
    token = runs ? `wd+${runs}` : 'wd';
  } else if (kind === 'noball') {
    teamRuns = conceded = 1 + runs; inn.extras++; batter.runs += runs; batter.balls++;
    if (runs === 4) batter.fours++; if (runs === 6) batter.sixes++;
    crossed = runs === 4 || runs === 6 ? 0 : runs; token = runs ? `nb+${runs}` : 'nb';
  } else if (kind === 'bye' || kind === 'legbye') {
    requireThat(runs > 0, 'Byes must include at least one run.');
    teamRuns = runs; inn.extras += runs; batter.balls++;
    crossed = runs === 4 ? 0 : runs; token = `${runs}${kind === 'bye' ? 'b' : 'lb'}`;
  } else {
    teamRuns = conceded = runs; batter.runs += runs; batter.balls++;
    if (runs === 4) batter.fours++; if (runs === 6) batter.sixes++;
    crossed = runs === 4 || runs === 6 ? 0 : runs; token = runs ? String(runs) : '•';
  }
  if (!inn.overBowlers.includes(inn.bowler)) inn.overBowlers.push(inn.bowler);
  bowler.runs += conceded; inn.overConceded += conceded;
  if (legal) { inn.legal++; bowler.legal++; if (kind !== 'wicket') inn.partnershipBalls++; }
  inn.total += teamRuns; inn.overRuns += teamRuns;
  if (kind !== 'wicket') inn.partnershipRuns += teamRuns;
  inn.thisOver.push(token);
  if (crossed % 2) swap(inn);
  if (legal && inn.legal % 6 === 0) {
    if (inn.overConceded === 0 && inn.overBowlers.length === 1) bowler.maidens++;
    inn.completedOvers.push({tokens: [...inn.thisOver], runs: inn.overRuns});
    inn.thisOver = []; inn.overRuns = 0; inn.overConceded = 0; inn.overBowlers = [];
    swap(inn); inn.awaitingBowler = !complete(inn, config);
  }
  return token;
}
function replay(doc) {
  if (!doc.config) return {active: false, innings: [], current: null, history: [], result: ''};
  const cfg = doc.config, innings = [newInnings(cfg, 1, null)], history = [];
  for (const [index, event] of doc.events.entries()) {
    const inn = innings.at(-1);
    switch (event.type) {
      case 'ball': {
        const position = overs(inn.legal), token = delivery(inn, event, cfg);
        history.push({index, innings: inn.number, position, token, event: clone(event)});
        break;
      }
      case 'bowler': {
        requireThat(!complete(inn, cfg), 'This innings has ended.');
        const name = text(event.name);
        requireThat(inn.fielders.includes(name), 'Choose a bowler from the fielding XI.');
        inn.bowler = name; inn.awaitingBowler = false;
        inn.bowlers[name] ||= {name, runs: 0, wickets: 0, legal: 0, maidens: 0};
        break;
      }
      case 'batter': {
        requireThat(inn.nextBat > 2 && !complete(inn, cfg), 'Change the new batter immediately after a wicket.');
        const index = inn.batters.findIndex(b => b.name === event.name);
        const arrived = [inn.striker, inn.nonStriker].find(i => i === inn.nextBat - 1 && inn.batters[i].balls === 0 && !inn.batters[i].out);
        requireThat(arrived !== undefined && index >= inn.nextBat && !inn.batters[index].out, 'Choose a player who has not batted, immediately after the wicket.');
        [inn.batters[arrived], inn.batters[index]] = [inn.batters[index], inn.batters[arrived]];
        break;
      }
      case 'swap': requireThat(!complete(inn, cfg), 'This innings has ended.'); swap(inn); break;
      case 'end': requireThat(!complete(inn, cfg), 'This innings has already ended.'); inn.ended = true; break;
      case 'next':
        requireThat(innings.length === 1 && complete(inn, cfg), 'Finish the first innings before starting the chase.');
        innings.push(newInnings(cfg, 2, inn.total + 1)); break;
      default: throw new Error('Unknown scoring action.');
    }
  }
  const current = innings.at(-1), matchOver = innings.length === 2 && complete(current, cfg);
  let result = '';
  if (matchOver) {
    if (current.total >= current.target) result = `${current.batting} won by ${10 - current.wickets} wicket${10 - current.wickets === 1 ? '' : 's'}`;
    else if (current.total === innings[0].total) result = 'Match tied';
    else { const margin = innings[0].total - current.total; result = `${innings[0].batting} won by ${margin} run${margin === 1 ? '' : 's'}`; }
  }
  return {active: true, innings, current, history, result, matchOver, inningsComplete: complete(current, cfg)};
}
function snapshot(doc) { return {revision: doc.revision, config: doc.config, appearance: doc.appearance, ...replay(doc)}; }
function mutate(original, action, body) {
  const doc = clone(original);
  if (action === 'setup') {
    requireThat(!doc.config || body.replace === true, 'Confirm starting a new match.');
    doc.config = normalizeConfig(body.config || {}); doc.events = [];
    doc.appearance.summaryType = 'none'; doc.appearance.summaryInnings = 'current';
  } else if (action === 'appearance') {
    doc.appearance = normalizeAppearance({...doc.appearance, ...(body.appearance || {})});
  } else {
    requireThat(doc.config, 'Set up a match first.');
    if (action === 'undo') { requireThat(doc.events.length > 0, 'Nothing to undo.'); doc.events.pop(); }
    else if (action === 'edit') {
      integer(body.index, 0, doc.events.length - 1, 'Ball index');
      requireThat(doc.events[body.index].type === 'ball', 'Choose a delivery to correct.');
      doc.events[body.index] = {...body.event, type: 'ball'};
    } else if (action === 'event') { requireThat(body.event && typeof body.event === 'object', 'Missing scoring action.'); doc.events.push(body.event); }
    else throw new Error('Unknown action.');
  }
  replay(doc); // Reject corrections that make later events invalid; original stays intact.
  doc.revision++;
  return doc;
}
module.exports = {normalizeConfig, normalizeAppearance, newDocument, replay, snapshot, mutate, overs};
