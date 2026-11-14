'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createApp} = require('./server.cjs');
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cricket-local-test-'));
  let server = createApp({dataDir: dir, password: 'test-password'});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.stop(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, token = '', origin = base) => fetch(base + '/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer ' + token}, body: JSON.stringify(body)});
  const login = await post('login', {password: 'test-password'}), {token} = await login.json();
  return {server, dir, base, post, token};
}
test('static pages and read-only state are public; mutations require auth and same origin', async t => {
  const {base, post, token} = await fixture(t);
  for (const page of ['/', '/overlay', '/app.js', '/api/state']) assert.equal((await fetch(base + page)).status, 200);
  assert.equal((await post('setup', {})).status, 401);
  assert.equal((await post('setup', {}, token, 'http://evil.example')).status, 403);
  assert.equal((await fetch(base + '/api/export')).status, 401);
  assert.equal((await fetch(base + '/access-code.txt')).status, 404);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base, {headers: {Host: 'evil.example'}}, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 421);
});
test('save, duplicate request, concurrent edit, export, archive and restart persistence', async t => {
  const {dir, base, post, token} = await fixture(t);
  const request = {revision: 0, requestId: 'request-setup-0001', config: {home: 'Test Home', away: 'Test Away', maxOvers: 20}};
  let response = await post('setup', request, token); assert.equal(response.status, 200);
  assert.equal((await post('setup', request, token)).status, 200);
  assert.equal((await post('appearance', {revision: 0, requestId: 'request-style-0001'}, token)).status, 409);
  const live = await (await fetch(base + '/api/state')).json(); assert.equal(live.revision, 1);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'match.json'))); assert.equal(stored.config.home, 'Test Home');
  const reloaded = createApp({dataDir: dir, password: 'test-password'}); reloaded.stop();
  response = await fetch(base + '/api/export', {headers: {Authorization: 'Bearer ' + token}}); assert.equal(response.status, 200); assert.equal((await response.json()).revision, 1);
  response = await post('setup', {...request, revision: 1, requestId: 'request-setup-0002', replace: true}, token); assert.equal(response.status, 200);
  assert.equal(fs.readdirSync(path.join(dir, 'archives')).length, 1);
});
test('two display consumers get identical updates and neither consumes scoring events', async t => {
  const {base, post, token} = await fixture(t), controller = new AbortController();
  t.after(() => controller.abort());
  const streams = await Promise.all([1, 2].map(() => fetch(base + '/api/events', {signal: controller.signal})));
  const readers = streams.map(s => s.body.getReader());
  for (const reader of readers) assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":0/);
  await post('setup', {revision: 0, requestId: 'stream-setup-0001', config: {home: 'Home', away: 'Away'}}, token);
  for (const reader of readers) assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":1/);
  controller.abort();
});
test('a broken saved file is never silently overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cricket-corrupt-test-'));
  try { fs.writeFileSync(path.join(dir, 'match.json'), '{broken'); assert.throws(() => createApp({dataDir: dir, password: 'test-password'})); assert.equal(fs.readFileSync(path.join(dir, 'match.json'), 'utf8'), '{broken'); }
  finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
