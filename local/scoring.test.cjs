'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {newDocument, mutate, replay} = require('./scoring.cjs');
function match(overs = 20) {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away', maxOvers: overs}});
  return mutate(doc, 'event', {event: {type: 'bowler', name: 'Away 1'}});
}
const ball = (doc, kind = 'run', runs = 0, extra = {}) => mutate(doc, 'event', {event: {type: 'ball', kind, runs, ...extra}});
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
