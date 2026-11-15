'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {newDocument, mutate, snapshot} = require('./scoring.cjs');

// Exercise the actual overlay event handler without launching a browser. This
// checks rendering behavior and HTML wiring, not browser layout or image decoding.
function display(search = '', port = '5081') {
  class Element {
    constructor(tag) { this.tagName = tag; this.dataset = {}; this.children = []; this.hidden = false; this.style = {setProperty(key, value) { this[key] = value; }}; }
    replaceChildren(...nodes) { this.children = nodes; }
    append(...nodes) { this.children.push(...nodes); }
    removeAttribute(name) { delete this[name]; }
    addEventListener() {}
  }
  const html = fs.readFileSync(path.join(__dirname, 'public/overlay.html'), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  let subscription;
  const location = {search, port, href: `http://127.0.0.1:${port}/overlay${search}`, replace(url) { this.redirected = url; }};
  const context = vm.createContext({
    document: {getElementById: id => nodes[id], createElement: tag => new Element(tag), body: new Element()},
    location, URL, URLSearchParams, console,
    EventSource: class { constructor() { subscription = this; } close() { this.closed = true; } },
    setTimeout: () => 0, clearTimeout: () => {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/media.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/summary.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/overlay.js'), 'utf8'), context);
  return {nodes, location, subscription, show: doc => subscription.onmessage({data: JSON.stringify(snapshot(doc))})};
}
const logo = letter => `/logos/${letter.repeat(64)}.png`;
test('corner logos keep their slots when team logos swap for the chase', () => {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away'}});
  doc = mutate(doc, 'appearance', {appearance: {homeLogo: logo('a'), awayLogo: logo('b'), channelLogo: logo('c'), sponsorLogo: logo('d'), teamLogoSize: 64}});
  const {nodes, show} = display(); show(doc);
  assert.equal(nodes['batting-team'].children[0].src, logo('a'));
  assert.equal(nodes['channel-corner-logo'].children[0].src, logo('c'));
  assert.equal(nodes['sponsor-corner-logo'].children[0].src, logo('d'));
  assert.equal(nodes.graphic.style['--team-logo-size'], '64px');
  doc = mutate(doc, 'event', {event: {type: 'end'}});
  doc = mutate(doc, 'event', {event: {type: 'next'}}); show(doc);
  assert.equal(nodes['batting-team'].children[0].src, logo('b'));
  assert.equal(nodes['bowling-team'].children[0].src, logo('a'));
  assert.equal(nodes['channel-corner-logo'].children[0].src, logo('c'));
  assert.equal(nodes['sponsor-corner-logo'].children[0].src, logo('d'));
});
test('corner size, margins and visibility work independently of the scorebar', () => {
  let doc = mutate(newDocument(), 'appearance', {appearance: {visible: false, channelLogo: logo('c'), sponsorLogo: logo('d'), channelLogoWidth: 180, channelLogoTop: 32, channelLogoSide: 48, sponsorLogoWidth: 280, sponsorLogoTop: 50, sponsorLogoSide: 60, sponsorVisible: false}});
  const {nodes, show} = display(); show(doc);
  assert.equal(nodes.graphic.hidden, true);
  assert.equal(nodes['channel-corner-logo'].hidden, false);
  assert.equal(nodes['channel-corner-logo'].style.width, '180px');
  assert.equal(nodes['channel-corner-logo'].style.top, '32px');
  assert.equal(nodes['channel-corner-logo'].style.maxHeight, '508px');
  assert.equal(nodes['channel-corner-logo'].style.right, '48px');
  assert.equal(nodes['channel-corner-logo'].style.left, undefined);
  assert.equal(nodes['sponsor-corner-logo'].hidden, true);
  assert.equal(nodes['sponsor-corner-logo'].style.left, '60px');
  assert.equal(nodes['sponsor-corner-logo'].style.right, undefined);
  doc = mutate(doc, 'appearance', {appearance: {channelLogo: '', sponsorVisible: true}}); show(doc);
  assert.equal(nodes['channel-corner-logo'].hidden, true);
  assert.equal(nodes['sponsor-corner-logo'].hidden, false);
});
const text = element => [element.textContent ?? '', ...element.children.map(text)].join(' ');
test('MP4 logos are silent looping videos in team, corner and summary graphics', () => {
  const movie = `/logos/${'e'.repeat(64)}.mp4`;
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away'}});
  doc = mutate(doc, 'appearance', {appearance: {homeLogo: movie, channelLogo: movie, sponsorLogo: logo('b')}});
  const view = display(); view.show(doc);
  const team = view.nodes['batting-team'].children[0], channel = view.nodes['channel-corner-logo'].children[0];
  for (const video of [team, channel]) {
    assert.equal(video.tagName, 'video'); assert.equal(video.muted, true); assert.equal(video.defaultMuted, true);
    assert.equal(video.loop, true); assert.equal(video.autoplay, true); assert.equal(video.playsInline, true);
    assert.equal(video.style.background, 'transparent');
  }
  doc = mutate(doc, 'appearance', {appearance: {title: 'New title'}}); view.show(doc);
  assert.equal(view.nodes['channel-corner-logo'].children[0], channel); // Score changes must not reload branding.
  const summary = display('?view=scorecard'); summary.show(doc);
  const find = e => e.tagName === 'video' ? e : e.children.map(find).find(Boolean);
  assert.equal(find(summary.nodes['summary-graphic']).src, movie);
});
test('uploaded WebM logos render as transparent looping video in either corner', () => {
  const movie = `/logos/${'c'.repeat(64)}.webm`;
  let doc = mutate(newDocument(), 'appearance', {appearance: {channelLogo: movie, sponsorLogo: movie}});
  const view = display(); view.show(doc);
  for (const slot of ['channel', 'sponsor']) {
    const media = view.nodes[slot + '-corner-logo'].children[0];
    assert.equal(media.tagName, 'video'); assert.equal(media.loop, true); assert.equal(media.muted, true);
    assert.equal(media.style.background, 'transparent'); assert.equal(media.src, movie);
  }
});
function scoredMatch() {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away', homeXI: ['Home Opener'], awayXI: ['Away Bowler']}});
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Away Bowler'}});
  doc = mutate(doc, 'event', {event: {type: 'ball', kind: 'run', runs: 4}});
  return mutate(doc, 'event', {event: {type: 'ball', kind: 'run', runs: 0}});
}
test('the main overlay switches between scorebar, scorecard, bowling and match summaries', () => {
  let doc = scoredMatch(); const {nodes, show} = display(); show(doc);
  assert.equal(nodes.graphic.hidden, false); assert.equal(nodes['summary-graphic'].hidden, true);
  for (const [type, title] of [['scorecard', 'INNINGS SCORECARD'], ['bowling', 'BOWLING ANALYSIS'], ['match', 'MATCH SUMMARY']]) {
    doc = mutate(doc, 'appearance', {appearance: {summaryType: type}}); show(doc);
    assert.equal(nodes.graphic.hidden, true); assert.equal(nodes['summary-graphic'].hidden, false);
    assert.ok(text(nodes['summary-graphic']).includes(title));
    if (type !== 'bowling') assert.ok(text(nodes['summary-graphic']).includes('Home Opener'));
    assert.ok(text(nodes['summary-graphic']).includes('Away Bowler'));
  }
  doc = mutate(doc, 'appearance', {appearance: {summaryType: 'none'}}); show(doc);
  assert.equal(nodes.graphic.hidden, false); assert.equal(nodes['summary-graphic'].hidden, true);
});
test('bowling economy uses legal deliveries and scorecard changes follow undo', () => {
  let doc = scoredMatch(); const {nodes, show} = display('?view=bowling'); show(doc);
  assert.ok(text(nodes['summary-graphic']).includes('12.00'));
  assert.equal(nodes['summary-graphic'].hidden, false);
  const innings = display('?view=scorecard'); innings.show(doc);
  assert.ok(text(innings.nodes['summary-graphic']).includes('4/0'));
  doc = mutate(doc, 'undo', {}); doc = mutate(doc, 'undo', {}); innings.show(doc);
  assert.ok(text(innings.nodes['summary-graphic']).includes('0/0'));
});
test('pinned innings wait until available and match summary reports the final result', () => {
  let doc = scoredMatch(); const pinned = display('?view=scorecard&innings=2'); pinned.show(doc);
  assert.ok(text(pinned.nodes['summary-graphic']).includes('has not started'));
  doc = mutate(doc, 'event', {event: {type: 'end'}}); doc = mutate(doc, 'event', {event: {type: 'next'}});
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Home Opener'}});
  doc = mutate(doc, 'event', {event: {type: 'ball', kind: 'run', runs: 6}});
  pinned.show(doc); assert.ok(text(pinned.nodes['summary-graphic']).includes('Second innings'));
  const summary = display('?view=match'); summary.show(doc);
  assert.ok(text(summary.nodes['summary-graphic']).includes('Away won by 10 wickets'));
  assert.ok(text(summary.nodes['summary-graphic']).includes('4/0'));
  assert.ok(text(summary.nodes['summary-graphic']).includes('6/0'));
});
test('an outdated overlay moves to the current server before consuming its data', () => {
  const old = display('?view=bowling', '5080'), frame = snapshot(scoredMatch()); delete frame.appearance.summaryType;
  old.subscription.onmessage({data: JSON.stringify(frame)});
  assert.equal(old.subscription.closed, true);
  assert.equal(old.location.redirected, 'http://127.0.0.1:5081/overlay?view=bowling');
});

test('three OBS sources keep their graphics and current innings independently of main-source controls', () => {
  let doc = scoredMatch();
  const sources = ['scorecard', 'match', 'bowling'].map(mode => ({mode, view: display('?view=' + mode)}));
  doc = mutate(doc, 'appearance', {appearance: {summaryType: 'none', summaryInnings: '2', visible: false}});
  for (const {mode, view} of sources) {
    view.show(doc);
    assert.equal(view.nodes['summary-graphic'].hidden, false);
    assert.equal(view.nodes['summary-graphic'].dataset.mode, mode);
    assert.equal(view.nodes.graphic.hidden, true);
    assert.ok(!text(view.nodes['summary-graphic']).includes('has not started'));
  }
  doc = mutate(doc, 'event', {event: {type: 'end'}});
  doc = mutate(doc, 'event', {event: {type: 'next'}});
  doc = mutate(doc, 'appearance', {appearance: {summaryType: 'match', summaryInnings: '1'}});
  for (const {mode, view} of sources) {
    view.show(doc); assert.equal(view.nodes['summary-graphic'].dataset.mode, mode);
    if (mode !== 'match') assert.ok(text(view.nodes['summary-graphic']).includes('Second innings'));
  }
  const pinned = display('?view=scorecard&innings=1'); pinned.show(doc);
  assert.ok(text(pinned.nodes['summary-graphic']).includes('First innings'));
  assert.ok(text(pinned.nodes['summary-graphic']).includes('require 5 to win'));
});

test('scorecard uses live batting status and conventional dismissal notation', () => {
  let doc = scoredMatch(); const view = display('?view=scorecard'); view.show(doc);
  let rendered = text(view.nodes['summary-graphic']);
  assert.ok(rendered.includes('yet to bat')); assert.ok(!rendered.includes('did not bat'));
  assert.ok(rendered.includes('Strike rate'));
  doc = mutate(doc, 'event', {event: {type: 'ball', kind: 'wicket', dismissal: 'bowled'}}); view.show(doc);
  rendered = text(view.nodes['summary-graphic']);
  assert.ok(rendered.includes('b Away Bowler')); assert.ok(!rendered.includes('bowled b'));
  doc = mutate(doc, 'event', {event: {type: 'end'}}); view.show(doc);
  rendered = text(view.nodes['summary-graphic']);
  assert.ok(rendered.includes('did not bat')); assert.ok(!rendered.includes('yet to bat'));
  doc = mutate(doc, 'undo', {}); view.show(doc);
  assert.ok(text(view.nodes['summary-graphic']).includes('yet to bat'));
});

test('match summary only advertises a target after the first innings ends', () => {
  let doc = scoredMatch(); const view = display('?view=match'); view.show(doc);
  assert.ok(!text(view.nodes['summary-graphic']).includes('Target'));
  assert.ok(text(view.nodes['summary-graphic']).includes('YET TO BAT'));
  doc = mutate(doc, 'event', {event: {type: 'end'}}); view.show(doc);
  assert.ok(text(view.nodes['summary-graphic']).includes('Target 5'));
});

test('bowling analysis identifies the batting total and uses team-specific accents', () => {
  let doc = scoredMatch(); const view = display('?view=bowling'); view.show(doc);
  const root = view.nodes['summary-graphic'];
  assert.ok(text(root).includes('Home innings')); assert.ok(text(root).includes('Maidens'));
  assert.ok(text(root).includes('runs conceded per over'));
  assert.equal(root.style['--summary-accent'], doc.appearance.awayColour);
  for (let i = 1; i < 11; i++) doc = mutate(doc, 'event', {event: {type: 'bowler', name: doc.config.awayXI[i]}});
  view.show(doc); assert.ok(root.children[0].className.includes('compact'));
});
