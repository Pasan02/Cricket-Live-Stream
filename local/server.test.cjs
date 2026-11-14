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

test('scoring page permits data URL logo previews without permitting remote images or blob scripts', async t => {
  const {base} = await fixture(t);
  const response = await fetch(base + '/scoring');
  const policy = new Map(response.headers.get('content-security-policy').split(';').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...sources]) => [name, sources]));
  assert.ok(policy.get('img-src').includes('data:'));
  assert.ok(policy.get('img-src').includes("'self'"));
  assert.ok(!policy.get('img-src').some(source => source === '*' || /^https?:/.test(source)));
  assert.deepEqual(policy.get('script-src'), ["'self'"]);
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

const redLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const blueLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==';
test('both team logos are served to displays and survive exports, restart and appearance edits', async t => {
  const {dir, base, post, token} = await fixture(t);
  let response = await post('logo', {revision: 0, requestId: 'logo-home-000001', side: 'home', data: redLogo}, token);
  assert.equal(response.status, 200);
  const home = (await response.json()).state.appearance.homeLogo;
  response = await post('logo', {revision: 1, requestId: 'logo-away-000001', side: 'away', data: blueLogo}, token);
  assert.equal(response.status, 200);
  const away = (await response.json()).state.appearance.awayLogo;
  assert.notEqual(home, away);
  for (const url of [home, away]) {
    const image = await fetch(base + url);
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  response = await post('appearance', {revision: 2, requestId: 'logo-style-00001', appearance: {title: 'Cup final'}}, token);
  const state = (await response.json()).state;
  assert.equal(state.appearance.homeLogo, home); assert.equal(state.appearance.awayLogo, away); assert.equal(state.appearance.title, 'Cup final');
  assert.equal(state.logos, undefined); // Images are fetched separately, not resent on every delivery.
  const exported = await (await fetch(base + '/api/export', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.equal(Object.keys(exported.logos).length, 2);
  const restarted = createApp({dataDir: dir, password: 'test-password'});
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  try {
    const reloaded = `http://127.0.0.1:${restarted.address().port}`;
    assert.equal((await (await fetch(reloaded + '/api/state')).json()).appearance.homeLogo, home);
    assert.equal((await fetch(reloaded + away)).status, 200);
  } finally { restarted.stop(); }
  response = await post('logo', {revision: 3, requestId: 'logo-remove-0001', side: 'home', data: null}, token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.appearance.homeLogo, '');
  assert.equal((await fetch(base + away)).status, 200);
  assert.equal((await fetch(base + home)).status, 404);
});
test('logo replacement cannot change scores, and stale or duplicate requests are safe', async t => {
  const {base, post, token} = await fixture(t);
  await post('setup', {revision: 0, requestId: 'logo-match-00001', config: {home: 'Home', away: 'Away'}}, token);
  const upload = {revision: 1, requestId: 'logo-first-00001', side: 'home', data: redLogo};
  const first = await (await post('logo', upload, token)).json();
  assert.equal((await post('logo', upload, token)).status, 200);
  assert.equal((await post('logo', {...upload, requestId: 'logo-stale-00001', data: blueLogo}, token)).status, 409);
  const updated = await (await post('logo', {revision: 2, requestId: 'logo-replace-001', side: 'home', data: blueLogo}, token)).json();
  assert.notEqual(updated.state.appearance.homeLogo, first.state.appearance.homeLogo);
  assert.equal(updated.state.current.total, 0); assert.equal(updated.state.current.legal, 0);
  assert.equal((await fetch(base + updated.state.appearance.homeLogo)).status, 200);
});
test('logo uploads reject unauthenticated, cross-origin, non-image and oversized content', async t => {
  const {base, post, token} = await fixture(t);
  const body = {revision: 0, requestId: 'logo-invalid-001', side: 'home', data: redLogo};
  assert.equal((await post('logo', body)).status, 401);
  assert.equal((await post('logo', body, token, 'http://evil.example')).status, 403);
  for (const invalid of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'https://evil.example/image.png', redLogo.slice(0, -8) + 'AAAAAAAA']) {
    assert.equal((await post('logo', {...body, data: invalid}, token)).status, 400);
  }
  assert.equal((await post('logo', {...body, side: '../../access-code.txt'}, token)).status, 400);
  assert.equal((await post('logo', {...body, data: 'x'.repeat(530000)}, token)).status, 413);
  assert.equal((await (await fetch(base + '/api/state')).json()).revision, 0);
});

test('all four logo slots persist independently, including shared image content', async t => {
  const {base, post, token, dir} = await fixture(t);
  let revision = 0;
  const urls = {};
  for (const [side, data] of [['home', redLogo], ['away', blueLogo], ['channel', redLogo], ['sponsor', blueLogo]]) {
    const response = await post('logo', {revision, requestId: `four-logo-upload-${side}`, side, data}, token);
    assert.equal(response.status, 200); const saved = (await response.json()).state;
    urls[side] = saved.appearance[side + 'Logo']; revision = saved.revision;
  }
  assert.equal(urls.home, urls.channel); assert.equal(urls.away, urls.sponsor);
  let response = await post('logo', {revision, requestId: 'four-logo-remove-home', side: 'home', data: null}, token);
  assert.equal(response.status, 200); revision++;
  assert.equal((await fetch(base + urls.channel)).status, 200);
  response = await post('appearance', {revision, requestId: 'four-logo-placement', appearance: {channelLogoWidth: 180, sponsorLogoWidth: 300, channelLogoTop: 50, sponsorLogoSide: 60, sponsorVisible: false, teamLogoSize: 64}}, token);
  assert.equal(response.status, 200);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'match.json'), 'utf8'));
  assert.equal(stored.appearance.channelLogo, urls.channel);
  assert.equal(stored.appearance.sponsorLogo, urls.sponsor);
  assert.equal(stored.appearance.homeLogo, '');
  assert.equal(stored.appearance.sponsorVisible, false);
  assert.equal(stored.appearance.teamLogoSize, 64);
  assert.equal(Object.keys(stored.logos).length, 2);
  const exported = await (await fetch(base + '/api/export', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.deepEqual(exported.appearance, stored.appearance);
  assert.deepEqual(exported.logos, stored.logos);
});
