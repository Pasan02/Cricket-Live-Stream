'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function openDesk(info, port) {
  const element = () => ({addEventListener() {}, showModal() {}, classList: {add() {}, toggle() {}}, elements: {scale: {addEventListener() {}}}});
  const nodes = new Map(); let subscriptions = 0;
  const location = {port, href: `http://127.0.0.1:${port}/scoring`, origin: `http://127.0.0.1:${port}`, replace(url) { this.redirected = url; }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'), {
    document: {getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelectorAll: () => []},
    fetch: async () => ({json: async () => info}), sessionStorage: {getItem: () => '', removeItem() {}}, location, URL,
    ResizeObserver: class { observe() {} }, EventSource: class { constructor() { subscriptions++; } },
    setTimeout: () => 0, clearTimeout() {}, console
  });
  await new Promise(resolve => setImmediate(resolve));
  return {location, subscriptions};
}
test('the scoring desk redirects an old backend before opening scoring subscriptions', async () => {
  const desk = await openDesk({addresses: ['192.168.1.10'], port: 5080}, '5080');
  assert.equal(desk.location.redirected, 'http://127.0.0.1:5081/scoring'); assert.equal(desk.subscriptions, 0);
});
test('the current backend is used directly, including a custom port', async () => {
  const desk = await openDesk({apiVersion: 3, addresses: [], port: 5090}, '5090');
  assert.equal(desk.location.redirected, undefined); assert.equal(desk.subscriptions, 1);
});

test('scoring desk selects openers and corrects names through the actual player forms', async () => {
  const {newDocument, mutate, snapshot} = require('./scoring.cjs');
  let doc = mutate(newDocument(), 'setup', {config: {home: 'Home', away: 'Away'}}), stream;
  const requests = [];
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.open = false;
      this.classList = {add() {}, toggle() {}}; this.parentElement = {classList: {toggle() {}}};
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    removeAttribute(name) { delete this[name]; }
    setCustomValidity(message) { this.invalid = message; }
    reportValidity() { return !this.invalid && this.children.every(child => child.reportValidity()); }
  }
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const fields = Object.fromEntries([...html.matchAll(/name="([^"]+)"/g)].map(m => [m[1], new Element('input')]));
  for (const id of ['appearance-form', 'setup-form']) nodes[id].elements = {namedItem: name => fields[name], scale: fields.scale};
  const context = vm.createContext({
    document: {getElementById: id => nodes[id], querySelectorAll: () => [], createElement: tag => new Element(tag), createTextNode: text => new Element('text')},
    fetch: async (url, options) => {
      if (url === '/api/info') return {json: async () => ({apiVersion: 3, playerEditing: true, addresses: [], port: 5081})};
      if (url === '/api/session') return {status: 200};
      const action = url.slice(5), body = JSON.parse(options.body); requests.push({action, body});
      assert.equal(body.revision, doc.revision); doc = mutate(doc, action, body);
      return {ok: true, status: 200, json: async () => ({state: JSON.parse(JSON.stringify(snapshot(doc)))})};
    },
    sessionStorage: {getItem: () => 'test-session'}, crypto: require('node:crypto').webcrypto,
    location: {origin: 'http://127.0.0.1:5081', port: '5081'}, URL, console,
    ResizeObserver: class {observe() {}}, EventSource: class {constructor() {stream = this;}},
    setTimeout: () => 0, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const show = () => stream.onmessage({data: JSON.stringify(snapshot(doc))}); show();
  assert.equal(nodes['choose-openers'].disabled, false);
  await nodes['choose-openers'].listeners.click();
  let form = nodes['action-content'].children[0];
  const selects = form.children.filter(e => e.tag === 'label').map(e => e.children[0]);
  selects[0].value = 'Home 4'; selects[1].value = 'Home 7';
  await form.listeners.submit({preventDefault() {}});
  assert.equal(requests.at(-1).body.event.type, 'openers');
  assert.equal(snapshot(doc).current.batters[0].name, 'Home 4');
  assert.equal(nodes.undo.disabled, false, 'Opening selection can be undone before choosing a bowler');
  doc = mutate(doc, 'event', {event: {type: 'bowler', name: 'Away 1'}});
  doc = mutate(doc, 'event', {event: {type: 'ball', kind: 'run', runs: 4}}); show();
  assert.equal(nodes['choose-openers'].disabled, true);
  await nodes['edit-players'].listeners.click();
  nodes['action-content'].children[0].children[0].listeners.click();
  form = nodes['action-content'].children[0];
  const inputs = form.children.filter(e => e.tag === 'label').map(e => e.children[0]);
  inputs[3].value = 'Corrected Opener';
  await form.listeners.submit({preventDefault() {}});
  assert.equal(requests.at(-1).action, 'players');
  assert.equal(snapshot(doc).current.batters[0].name, 'Corrected Opener');
  assert.equal(snapshot(doc).current.batters[0].runs, 4);
  assert.equal(nodes['action-dialog'].open, false);
});
