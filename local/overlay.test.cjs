'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {newDocument, mutate, snapshot} = require('./scoring.cjs');

// Exercise the actual overlay event handler without launching a browser. This
// checks rendering behavior and HTML wiring, not browser layout or image decoding.
function display() {
  class Element {
    constructor() { this.dataset = {}; this.children = []; this.hidden = false; this.style = {setProperty(key, value) { this[key] = value; }}; }
    replaceChildren(...nodes) { this.children = nodes; }
    append(...nodes) { this.children.push(...nodes); }
    removeAttribute(name) { delete this[name]; }
    addEventListener() {}
  }
  const html = fs.readFileSync(path.join(__dirname, 'public/overlay.html'), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  let subscription;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'public/overlay.js'), 'utf8'), {
    document: {getElementById: id => nodes[id], createElement: () => new Element(), body: new Element()},
    location: {search: ''}, URLSearchParams, console,
    EventSource: class { constructor() { subscription = this; } },
    setTimeout: () => 0, clearTimeout: () => {}
  });
  return {nodes, show: doc => subscription.onmessage({data: JSON.stringify(snapshot(doc))})};
}
const logo = letter => `/logos/${letter.repeat(64)}.png`;
test('corner logos keep their slots when team logos swap for the chase', () => {
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away'}});
  doc = mutate(doc, 'appearance', {appearance: {homeLogo: logo('a'), awayLogo: logo('b'), channelLogo: logo('c'), sponsorLogo: logo('d'), teamLogoSize: 64}});
  const {nodes, show} = display(); show(doc);
  assert.equal(nodes['batting-team'].children[0].src, logo('a'));
  assert.equal(nodes['channel-corner-logo'].src, logo('c'));
  assert.equal(nodes['sponsor-corner-logo'].src, logo('d'));
  assert.equal(nodes.graphic.style['--team-logo-size'], '64px');
  doc = mutate(doc, 'event', {event: {type: 'end'}});
  doc = mutate(doc, 'event', {event: {type: 'next'}}); show(doc);
  assert.equal(nodes['batting-team'].children[0].src, logo('b'));
  assert.equal(nodes['bowling-team'].children[0].src, logo('a'));
  assert.equal(nodes['channel-corner-logo'].src, logo('c'));
  assert.equal(nodes['sponsor-corner-logo'].src, logo('d'));
});
test('corner size, margins and visibility work independently of the scorebar', () => {
  let doc = mutate(newDocument(), 'appearance', {appearance: {visible: false, channelLogo: logo('c'), sponsorLogo: logo('d'), channelLogoWidth: 180, channelLogoTop: 32, channelLogoSide: 48, sponsorLogoWidth: 280, sponsorLogoTop: 50, sponsorLogoSide: 60, sponsorVisible: false}});
  const {nodes, show} = display(); show(doc);
  assert.equal(nodes.graphic.hidden, true);
  assert.equal(nodes['channel-corner-logo'].hidden, false);
  assert.equal(nodes['channel-corner-logo'].style.width, '180px');
  assert.equal(nodes['channel-corner-logo'].style.top, '32px');
  assert.equal(nodes['channel-corner-logo'].style.maxHeight, '508px');
  assert.equal(nodes['channel-corner-logo'].style.left, '48px');
  assert.equal(nodes['sponsor-corner-logo'].hidden, true);
  assert.equal(nodes['sponsor-corner-logo'].style.right, '60px');
  doc = mutate(doc, 'appearance', {appearance: {channelLogo: '', sponsorVisible: true}}); show(doc);
  assert.equal(nodes['channel-corner-logo'].hidden, true);
  assert.equal(nodes['sponsor-corner-logo'].hidden, false);
});
