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
