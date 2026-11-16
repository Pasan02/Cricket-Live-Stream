'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {newDocument, mutate, replay, snapshot} = require('./scoring.cjs');
function match(overs = 20) {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away', maxOvers: overs}});
  return mutate(doc, 'event', {event: {type: 'bowler', name: 'Away 1'}});
}
const ball = (doc, kind = 'run', runs = 0, extra = {}) => mutate(doc, 'event', {event: {type: 'ball', kind, runs, ...extra}});

test('choose both opening batters and first-ball striker in either innings; undo restores defaults', () => {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away'}});
  const defaults = doc;
  doc = mutate(doc, 'event', {event: {type: 'openers', striker: 'Home 5', nonStriker: 'Home 8'}});
  let inn = replay(doc).current;
  assert.equal(inn.batters[inn.striker].name, 'Home 5'); assert.equal(inn.batters[inn.nonStriker].name, 'Home 8');
  assert.equal(inn.batters[2].name, 'Home 1'); assert.equal(new Set(inn.batters.map(b => b.name)).size, 11);
  assert.equal(snapshot(doc).canUndo, true); assert.deepEqual(replay(mutate(doc, 'undo', {})), replay(defaults));
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Away 1'}}); doc = ball(doc, 'run', 4);
  assert.equal(replay(doc).current.batters[0].runs, 4);
  doc = mutate(doc, 'event', {event: {type: 'end'}}); doc = mutate(doc, 'event', {event: {type: 'next'}});
  doc = mutate(doc, 'event', {event: {type: 'openers', striker: 'Away 7', nonStriker: 'Away 3'}});
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Home 9'}}); doc = ball(doc);
  inn = replay(doc).current;
  assert.equal(inn.batters[inn.striker].name, 'Away 7'); assert.equal(inn.batters[0].balls, 1);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(doc))), replay(doc));
});

test('opening selection rejects duplicate/opposition players and all deliveries lock it, including wides', () => {
  const start = match();
  for (const [striker, nonStriker] of [['Home 1', 'Home 1'], ['Home 1', 'Away 2'], ['', 'Home 2']]) assert.throws(() => mutate(start, 'event', {event: {type: 'openers', striker, nonStriker}}));
  for (const kind of ['wide', 'noball', 'run']) {
    const doc = ball(start, kind);
    assert.throws(() => mutate(doc, 'event', {event: {type: 'openers', striker: 'Home 3', nonStriker: 'Home 4'}}), /before the first delivery/);
  }
});

test('name corrections preserve both innings and update only the right team, including dismissals', () => {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away', homeXI: ['Shared', 'Fielder'], awayXI: ['Shared', 'Fielder']}});
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Shared'}});
  doc = ball(doc, 'run', 4); doc = ball(doc, 'wicket', 0, {dismissal: 'caught', fielder: 'Fielder'});
  doc = mutate(doc, 'event', {event: {type: 'end'}}); doc = mutate(doc, 'event', {event: {type: 'next'}});
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Shared'}});
  doc = ball(doc, 'wicket', 0, {dismissal: 'caught', fielder: 'Fielder'});
  const before = replay(doc), count = doc.events.length;
  const names = [...doc.config.homeXI]; names[0] = 'Home Captain'; names[1] = 'Home Keeper';
  doc = mutate(doc, 'players', {side: 'home', names});
  const after = replay(doc);
  assert.equal(doc.events.length, count);
  assert.equal(after.innings[0].batters[0].name, 'Home Captain');
  assert.equal(after.innings[0].batters[0].out, 'caught (Fielder) b Shared');
  assert.equal(after.innings[1].batters[0].name, 'Shared');
  assert.equal(after.innings[1].batters[0].out, 'caught (Home Keeper) b Home Captain');
  assert.deepEqual(after.innings.map(i => [i.total, i.wickets, i.legal, i.extras]), before.innings.map(i => [i.total, i.wickets, i.legal, i.extras]));
  assert.equal(after.innings[0].bowlers.Shared.runs, 4); assert.equal(after.current.bowlers['Home Captain'].wickets, 1);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(doc))), after);
  doc = mutate(doc, 'undo', {}); assert.equal(replay(doc).current.bowler, 'Home Captain');
});

test('renaming selected openers, replacement batters and bowlers keeps their figures and corrections', () => {
  let doc = match();
  doc = mutate(doc, 'event', {event: {type: 'openers', striker: 'Home 5', nonStriker: 'Home 6'}});
  doc = ball(doc, 'run', 4); doc = ball(doc, 'wicket', 0, {dismissal: 'bowled'});
  doc = mutate(doc, 'event', {event: {type: 'batter', name: 'Home 9'}});
  doc = ball(doc, 'run', 2);
  const names = [...doc.config.homeXI]; names[4] = 'Alice'; names[8] = 'New Batter';
  doc = mutate(doc, 'players', {side: 'home', names});
  const bowlers = [...doc.config.awayXI]; bowlers[0] = '__proto__';
  doc = mutate(doc, 'players', {side: 'away', names: bowlers});
  let inn = replay(doc).current;
  assert.equal(inn.batters[0].name, 'Alice'); assert.equal(inn.batters[0].runs, 4);
  assert.equal(inn.batters[2].name, 'New Batter'); assert.equal(inn.batters[2].runs, 2);
  assert.equal(inn.batters[0].out, 'bowled b __proto__'); assert.equal(inn.bowlers.__proto__.runs, 6);
  doc = mutate(doc, 'edit', {index: doc.events.length - 1, event: {kind: 'run', runs: 6}});
  inn = replay(doc).current; assert.equal(inn.batters[2].runs, 6); assert.equal(inn.bowlers.__proto__.runs, 10);
});

test('simultaneous name swaps preserve player identities and invalid roster edits are atomic', () => {
  const original = ball(match(), 'run', 4), saved = JSON.stringify(original);
  const names = [...original.config.homeXI]; [names[0], names[1]] = [names[1], names[0]];
  const renamed = mutate(original, 'players', {side: 'home', names});
  assert.equal(replay(renamed).current.batters[0].name, 'Home 2'); assert.equal(replay(renamed).current.batters[0].runs, 4);
  for (const replacement of [names.slice(0, 10), ['', ...names.slice(1)], [names[1], ...names.slice(1)], ['x'.repeat(65), ...names.slice(1)], [null, ...names.slice(1)]]) assert.throws(() => mutate(original, 'players', {side: 'home', names: replacement}));
  assert.throws(() => mutate(original, 'players', {side: '__proto__', names}));
  assert.equal(JSON.stringify(original), saved);
});
test('runs, extras, strike and bowling figures follow the scoring book', () => {
  let doc = match();
  doc = ball(doc, 'run', 1); doc = ball(doc, 'wide', 2); doc = ball(doc, 'noball', 4); doc = ball(doc, 'bye', 2); doc = ball(doc, 'legbye', 1);
  const inn = replay(doc).current;
  assert.equal(inn.total, 12); assert.equal(inn.extras, 7); assert.equal(inn.legal, 3);
  assert.equal(inn.bowlers['Away 1'].runs, 9); assert.equal(inn.batters[1].runs, 4); assert.equal(inn.batters[1].balls, 3);
  assert.equal(inn.striker, 0);
});
test('six legal balls complete an over; extras do not, and the next bowler is required', () => {
  let doc = match(); doc = ball(doc, 'wide'); doc = ball(doc, 'noball');
  for (let i = 0; i < 6; i++) doc = ball(doc);
  const inn = replay(doc).current;
  assert.equal(inn.legal, 6); assert.equal(inn.completedOvers[0].tokens.length, 8); assert.equal(inn.awaitingBowler, true); assert.equal(inn.striker, 1);
  assert.throws(() => ball(doc), /Select the bowler/);
});
test('a shared over is not a maiden; byes do not count against a bowler', () => {
  let doc = match(); doc = ball(doc, 'bye', 4);
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Away 2'}});
  for (let i = 0; i < 5; i++) doc = ball(doc);
  const inn = replay(doc).current;
  assert.equal(inn.bowlers['Away 1'].runs, 0); assert.equal(inn.bowlers['Away 2'].maidens, 0);
});
test('run out distinguishes the non-striker and does not credit the bowler', () => {
  const doc = ball(match(), 'wicket', 1, {dismissal: 'run out', nonStriker: true, fielder: 'Away 2'});
  const inn = replay(doc).current;
  assert.match(inn.batters[1].out, /run out/); assert.equal(inn.bowlers['Away 1'].wickets, 0);
  assert.equal(inn.batters[0].runs, 1); assert.equal(inn.total, 1); assert.equal(inn.striker, 2);
});
test('new batter selection, wicket undo and ball corrections rebuild correctly', () => {
  let doc = ball(match(), 'wicket', 0, {dismissal: 'caught'});
  doc = mutate(doc, 'event', {event: {type: 'batter', name: 'Home 5'}});
  assert.equal(replay(doc).current.batters[2].name, 'Home 5');
  doc = mutate(doc, 'undo', {}); doc = mutate(doc, 'undo', {});
  assert.equal(replay(doc).current.wickets, 0);
  doc = ball(doc, 'run', 4);
  doc = mutate(doc, 'edit', {index: doc.events.length - 1, event: {kind: 'run', runs: 6}});
  assert.equal(replay(doc).current.total, 6);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(doc))), replay(doc));
});
test('second innings target, result and undo across the innings break', () => {
  let doc = ball(match(1), 'run', 4);
  doc = mutate(doc, 'event', {event: {type: 'end'}}); doc = mutate(doc, 'event', {event: {type: 'next'}});
  assert.equal(replay(doc).current.target, 5);
  const before = mutate(doc, 'undo', {}); assert.equal(replay(before).current.number, 1);
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Home 1'}}); doc = ball(doc, 'run', 6);
  assert.equal(replay(doc).matchOver, true); assert.match(replay(doc).result, /Away won by 10 wickets/);
  assert.throws(() => ball(doc), /ended/);
});
test('10 wickets end the innings without admitting extra deliveries', () => {
  let doc = match();
  for (let i = 0; i < 10; i++) {
    if (replay(doc).current.awaitingBowler) doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Away 2'}});
    doc = ball(doc, 'wicket', 0, {dismissal: 'bowled'});
  }
  assert.equal(replay(doc).inningsComplete, true); assert.throws(() => ball(doc), /ended/);
});
test('invalid events or corrections never mutate the accepted document', () => {
  const doc = match(), original = JSON.stringify(doc);
  assert.throws(() => ball(doc, 'run', -1), /Runs/); assert.throws(() => ball(doc, 'wicket', 0, {dismissal: '<script>'}), /dismissal/);
  assert.equal(JSON.stringify(doc), original);
  assert.throws(() => mutate(doc, 'appearance', {appearance: {homeColour: 'url(evil)'}}), /colour/);
});
test('tie and defending-side result use completed innings totals', () => {
  for (const [reply, expected] of [[4, 'Match tied'], [2, 'Home won by 2 runs']]) {
    let doc = ball(match(), 'run', 4);
    doc = mutate(doc, 'event', {event: {type: 'end'}});
    doc = mutate(doc, 'event', {event: {type: 'next'}});
    doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Home 1'}});
    doc = ball(doc, 'run', reply);
    doc = mutate(doc, 'event', {event: {type: 'end'}});
    assert.equal(replay(doc).result, expected);
  }
});
test('player names that match JavaScript object properties remain ordinary bowlers', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away', awayXI: [name]}});
    doc = mutate(doc, 'event', {event: {type: 'bowler', name}});
    doc = ball(doc, 'run', 4);
    const inn = replay(doc).current;
    assert.equal(inn.bowlers[name].runs, 4);
    assert.equal(inn.bowlers[name].legal, 1);
    assert.equal(Object.prototype.runs, undefined);
  }
});
test('logo placement accepts valid bounds and rejects unsafe or invalid values', () => {
  const doc = newDocument();
  assert.equal(doc.appearance.teamLogoSize, 56);
  assert.equal(doc.appearance.channelLogoTop, 40);
  assert.equal(doc.appearance.sponsorLogoSide, 40);
  for (const appearance of [{teamLogoSize: 1000}, {channelLogoTop: -1}, {sponsorLogoWidth: 361}, {channelLogoSide: '40'}, {sponsorVisible: 'yes'}, {channelLogo: 'https://external.example/logo.png'}]) {
    assert.throws(() => mutate(doc, 'appearance', {appearance}));
  }
});
