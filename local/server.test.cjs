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
  for (const page of ['/', '/overlay', '/app.js', '/media.js', '/summary.js', '/summary.css', '/api/state']) assert.equal((await fetch(base + page)).status, 200);
  assert.equal((await (await fetch(base + '/api/info')).json()).apiVersion, 3);
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
  assert.deepEqual(policy.get('media-src'), ["'self'", 'data:']);
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

// Synthetic WebM metadata and alpha-bearing block structure. These tests check
// validation and byte preservation, not video decoding in a real browser.
function webmFixture({codec = 'V_VP9', width = 64, seconds = 2, doctype = 'webm', duration = true, unknownSegment = false} = {}) {
  const element = (id, data, unknown = false) => {
    let length = 1; while (data.length >= 2 ** (length * 7) - 1) length++;
    const size = Buffer.alloc(length); let bits = BigInt(data.length) | (1n << BigInt(length * 7));
    for (let i = length - 1; i >= 0; i--) { size[i] = Number(bits & 255n); bits >>= 8n; }
    return Buffer.concat([Buffer.from(id, 'hex'), unknown ? Buffer.from('01ffffffffffffff', 'hex') : size, data]);
  };
  const uint = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const time = Buffer.alloc(8); time.writeDoubleBE(seconds * 1000);
  const info = element('1549a966', Buffer.concat([element('2ad7b1', uint(1000000)), ...(duration ? [element('4489', time)] : [])]));
  const video = element('e0', Buffer.concat([element('b0', uint(width)), element('ba', uint(64)), element('53c0', Buffer.from([1]))]));
  const track = element('ae', Buffer.concat([element('d7', Buffer.from([1])), element('83', Buffer.from([1])), element('86', Buffer.from(codec)), video]));
  const additions = element('75a1', element('a6', element('a5', Buffer.from([0, 1, 2, 255]))));
  const block = element('a0', Buffer.concat([element('a1', Buffer.from([129, 0, 0, 0, 42])), additions]));
  const cluster = element('1f43b675', Buffer.concat([element('e7', Buffer.from([0])), block]));
  return Buffer.concat([element('1a45dfa3', element('4282', Buffer.from(doctype))), element('18538067', Buffer.concat([info, element('1654ae6b', track), cluster]), unknownSegment)]);
}

test('WebM uploads validate codecs and limits while preserving alpha block bytes', () => {
  const {normalizeWebm} = require('./logos.cjs');
  const url = bytes => 'data:video/webm;base64,' + bytes.toString('base64');
  for (const options of [{}, {codec: 'V_VP8'}, {unknownSegment: true}]) {
    const bytes = webmFixture(options); assert.equal(normalizeWebm(url(bytes)).data, bytes.toString('base64'));
  }
  for (const options of [{codec: 'V_MPEG4/ISO/AVC'}, {doctype: 'matroska'}, {width: 2000}, {seconds: 61}, {duration: false}]) assert.throws(() => normalizeWebm(url(webmFixture(options))));
  assert.throws(() => normalizeWebm(url(Buffer.from('not a video'))));
  assert.throws(() => normalizeWebm(url(webmFixture().subarray(0, -1))));
  assert.throws(() => normalizeWebm(url(Buffer.alloc(5 * 1024 * 1024 + 1))));
});

test('direct WebM uploads work in every logo slot, survive restart, and retain exact file bytes', async t => {
  const {base, post, token, dir} = await fixture(t), bytes = webmFixture();
  const data = 'data:video/webm;base64,' + bytes.toString('base64');
  const body = {revision: 0, requestId: 'webm-upload-home-01', side: 'home', data};
  assert.equal((await post('logo', body)).status, 401);
  assert.equal((await post('logo', body, token, 'http://evil.example')).status, 403);
  assert.equal((await post('logo', {...body, data: 'data:video/quicktime;base64,' + bytes.toString('base64')}, token)).status, 400);
  let url;
  for (const [revision, side] of ['home', 'away', 'channel', 'sponsor'].entries()) {
    const response = await post('logo', {...body, revision, side, requestId: 'webm-upload-' + side}, token);
    assert.equal(response.status, 200); url = (await response.json()).state.appearance[side + 'Logo']; assert.match(url, /\.webm$/);
  }
  let response = await fetch(base + url); assert.equal(response.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  response = await fetch(base + url, {headers: {Range: 'bytes=0-7'}}); assert.equal(response.status, 206);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(0, 8));
  assert.equal((await post('appearance', {revision: 4, requestId: 'webm-style-title-01', appearance: {title: 'Cup final'}}, token)).status, 200);
  const exported = await (await fetch(base + '/api/export', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.equal(Object.keys(exported.logos).length, 1); assert.equal(Object.values(exported.logos)[0], bytes.toString('base64'));
  const restarted = createApp({dataDir: dir, password: 'test-password'});
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  try {
    response = await fetch(`http://127.0.0.1:${restarted.address().port}${url}`); assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally { restarted.stop(); }
  for (const [i, side] of ['home', 'away', 'channel', 'sponsor'].entries()) assert.equal((await post('logo', {revision: i + 5, side, requestId: 'webm-remove-' + side, data: null}, token)).status, 200);
  assert.equal((await fetch(base + url)).status, 404);
});

// Synthetic ISO BMFF structure for validation/storage tests, not a video decoder test.
function mp4Fixture({codec = 'avc1', width = 640, seconds = 3, external = false} = {}) {
  const box = (name, ...parts) => { const data = Buffer.concat(parts), out = Buffer.alloc(data.length + 8); out.writeUInt32BE(out.length); out.write(name, 4, 4, 'ascii'); data.copy(out, 8); return out; };
  const movieHeader = Buffer.alloc(100); movieHeader.writeUInt32BE(1000, 12); movieHeader.writeUInt32BE(seconds * 1000, 16);
  const handler = Buffer.alloc(24); handler.write('vide', 8);
  const referenceHeader = Buffer.alloc(8); referenceHeader.writeUInt32BE(1, 4);
  const reference = Buffer.alloc(4); reference.writeUInt32BE(external ? 0 : 1);
  const sample = Buffer.alloc(78); sample.writeUInt16BE(1, 6); sample.writeUInt16BE(width, 24); sample.writeUInt16BE(360, 26);
  const descriptionHeader = Buffer.alloc(8); descriptionHeader.writeUInt32BE(1, 4);
  const sampleDescription = box('stsd', descriptionHeader, box(codec, sample, box('avcC', Buffer.from([1, 100, 0, 31, 255, 224, 0]))));
  const track = box('trak', box('mdia', box('hdlr', handler), box('minf', box('dinf', box('dref', referenceHeader, box('url ', reference))), box('stbl', sampleDescription))));
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isomavc1', 'binary')), box('moov', box('mvhd', movieHeader), track), box('mdat', Buffer.from([0, 0, 0, 1, 101]))]);
}

test('MP4 logos validate H.264 container limits and reject external references and forged files', () => {
  const {normalizeVideo} = require('./logos.cjs');
  const url = bytes => 'data:video/mp4;base64,' + bytes.toString('base64');
  const bytes = mp4Fixture(); assert.equal(normalizeVideo(url(bytes)).data, bytes.toString('base64'));
  for (const invalid of [Buffer.from('<script>alert(1)</script>'), bytes.subarray(0, bytes.length - 1), mp4Fixture({codec: 'hvc1'}), mp4Fixture({seconds: 61}), mp4Fixture({width: 2000}), mp4Fixture({external: true})]) assert.throws(() => normalizeVideo(url(invalid)));
  assert.throws(() => normalizeVideo(url(Buffer.alloc(5 * 1024 * 1024 + 1))));
});

test('MP4 logos persist, stream byte ranges, share slots and remain self-contained in exports', async t => {
  const {base, post, token, dir} = await fixture(t), bytes = mp4Fixture();
  const data = 'data:video/mp4;base64,' + bytes.toString('base64');
  const upload = {revision: 0, requestId: 'video-logo-channel-01', side: 'channel', data};
  assert.equal((await post('logo', upload)).status, 401);
  assert.equal((await post('logo', upload, token, 'http://evil.example')).status, 403);
  let response = await post('logo', upload, token); assert.equal(response.status, 200);
  const url = (await response.json()).state.appearance.channelLogo; assert.match(url, /\.mp4$/);
  response = await fetch(base + url); assert.equal(response.headers.get('content-type'), 'video/mp4'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(base + url.replace('.mp4', '.png'))).status, 404);
  for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=8-', 8, bytes.length - 1], ['bytes=-8', bytes.length - 8, bytes.length - 1], ['bytes=1-999999', 1, bytes.length - 1]]) {
    response = await fetch(base + url, {headers: {Range: range}}); assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
  }
  for (const range of ['bytes=999999-', 'bytes=8-2', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=-']) assert.equal((await fetch(base + url, {headers: {Range: range}})).status, 416);
  for (const [i, side] of ['home', 'away', 'sponsor'].entries()) assert.equal((await post('logo', {...upload, revision: i + 1, side, requestId: 'video-upload-' + side}, token)).status, 200);
  response = await post('logo', {revision: 4, requestId: 'video-remove-channel', side: 'channel', data: null}, token); assert.equal(response.status, 200);
  assert.equal((await fetch(base + url)).status, 200); // Other slots still reference it.
  const exported = await (await fetch(base + '/api/export', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.equal(Object.keys(exported.logos).length, 1); assert.equal(Object.values(exported.logos)[0], bytes.toString('base64'));
  const restarted = createApp({dataDir: dir, password: 'test-password'});
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${restarted.address().port}${url}`)).status, 200); } finally { restarted.stop(); }
  for (const [i, side] of ['home', 'away', 'sponsor'].entries()) assert.equal((await post('logo', {revision: i + 5, side, requestId: 'video-remove-' + side, data: null}, token)).status, 200);
  assert.equal((await fetch(base + url)).status, 404);
});
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
  assert.equal((await post('logo', {...body, data: 'x'.repeat(530000)}, token)).status, 400);
  assert.equal((await post('logo', {...body, data: 'x'.repeat(7100000)}, token)).status, 413);
  assert.equal((await post('appearance', {...body, padding: 'x'.repeat(66000)}, token)).status, 413);
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
test('summary controls persist without changing scores and reset for a new match', async t => {
  const {base, post, token} = await fixture(t);
  await post('setup', {revision: 0, requestId: 'summary-setup-001', config: {home: 'Home', away: 'Away'}}, token);
  let response = await post('appearance', {revision: 1, requestId: 'summary-show-0001', appearance: {summaryType: 'bowling', summaryInnings: '1'}}, token);
  assert.equal(response.status, 200); let state = (await response.json()).state;
  assert.equal(state.appearance.summaryType, 'bowling'); assert.equal(state.current.total, 0);
  response = await post('appearance', {revision: 2, requestId: 'summary-invalid1', appearance: {summaryType: '<script>'}}, token);
  assert.equal(response.status, 400);
  response = await post('setup', {revision: 2, requestId: 'summary-new-0001', config: {home: 'New Home', away: 'New Away'}, replace: true}, token);
  state = (await response.json()).state;
  assert.equal(state.appearance.summaryType, 'none'); assert.equal(state.appearance.summaryInnings, 'current');
  assert.equal((await fetch(base + '/overlay?view=match')).status, 200);
});
test('native startup refuses an already occupied port instead of serving a second copy', async t => {
  const {server, dir} = await fixture(t);
  // Spawn asynchronously: the existing server must keep answering the probe.
  const {spawn} = require('node:child_process');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs'), '--lan', '--port', String(server.address().port)], {env: {...process.env, SCOREBOARD_DATA_DIR: dir, SCOREBOARD_PASSWORD: 'test-password'}, windowsHide: true});
  let error = ''; child.stderr.on('data', chunk => error += chunk);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 1); assert.match(error, /already in use/);
});
