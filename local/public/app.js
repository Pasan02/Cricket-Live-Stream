'use strict';
const $ = id => document.getElementById(id);
let state = null, pending = false, logoBusy = false, connected = false, initialTab = false, initializedForms = false, editing = null, editingRevision = null, toastTimer;
let token = sessionStorage.getItem('cricketstream-local-token') || '';
const runtimeReady = fetch('/api/info').then(r => r.json()).then(info => {
  if (info.apiVersion === 3) return info;
  if (location.port !== '5081') { const target = new URL(location.href); target.port = '5081'; location.replace(target.href); return null; }
  toast('This page reached an older server. Close old CricketStream terminals and run Start-Scoreboard-LAN.cmd again.');
  return null;
}).catch(() => { toast('Could not reach the current scoreboard server. Start the app and refresh this page.'); return null; });
const overs = balls => `${Math.floor(balls / 6)}.${balls % 6}`;
function el(tag, content, className) { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
function tab(name) { document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + name); document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name)); resizePreviews(); }
function resizePreviews() { document.querySelectorAll('.preview-window').forEach(w => { w.querySelector('iframe').style.transform = `scale(${w.clientWidth / 1920})`; }); }
document.querySelectorAll('.preview-window').forEach(w => new ResizeObserver(resizePreviews).observe(w));
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => tab(b.dataset.go)));

function showLogin() { token = ''; sessionStorage.removeItem('cricketstream-local-token'); $('logout').hidden = true; if (!$('login-dialog').open) $('login-dialog').showModal(); updateControls(); }
$('login-dialog').addEventListener('cancel', event => event.preventDefault());
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!await runtimeReady) return; const button = event.submitter; button.disabled = true;
  try {
    const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: $('password').value})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    token = data.token; sessionStorage.setItem('cricketstream-local-token', token); $('password').value = ''; $('login-error').textContent = '';
    $('login-dialog').close(); $('logout').hidden = false; updateControls();
  } catch (error) { $('login-error').textContent = error.message || 'Could not connect.'; } finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await fetch('/api/logout', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: '{}'}); } finally { showLogin(); } });
async function post(action, body = {}, expectedRevision = state?.revision) {
  if (pending || !state) return false;
  if (!token) { showLogin(); return false; }
  if (!connected) { toast('Connection lost. Wait for the desk to reconnect before scoring.'); return false; }
  pending = true; updateControls();
  try {
    const response = await fetch('/api/' + action, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      body: JSON.stringify({...body, revision: expectedRevision, requestId: requestId()})});
    const data = await response.json();
    if (data.state) render(data.state);
    if (response.status === 401) showLogin();
    if (!response.ok) throw new Error(data.error || 'Could not save.');
    return true;
  } catch (error) { toast(error.message || 'Connection lost. Check the score before trying again.'); return false; }
  finally { pending = false; updateControls(); }
}
function requestId() { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function updateControls() {
  const locked = pending || logoBusy || !token || !state || !connected;
  const notPlaying = locked || !state?.active || state?.inningsComplete || state?.current?.awaitingBowler;
  document.querySelectorAll('[data-run], [data-extra], #wicket').forEach(b => b.disabled = notPlaying);
  for (const id of ['choose-bowler', 'swap', 'end-innings']) $(id).disabled = locked || !state?.active || state.inningsComplete;
  $('choose-batter').disabled = locked || !newBatterCanChange();
  $('undo').disabled = locked || !state?.active || state.current === null || !state.history.length && !state.current.bowler;
  $('export').disabled = locked || !state?.active;
  document.querySelectorAll('[data-summary], #summary-innings').forEach(button => button.disabled = locked || !state?.active);
  document.querySelectorAll('#appearance-form button, #setup-form button, #history button, #action-content button, #match-notice button').forEach(b => b.disabled = locked);
  document.querySelectorAll('[data-logo-upload]').forEach(b => b.disabled = locked);
  document.querySelectorAll('[data-logo-remove]').forEach(b => b.disabled = locked || !state.appearance[b.dataset.logoRemove + 'Logo']);
}
function newBatterCanChange() {
  const inn = state?.current; if (!inn || inn.nextBat <= 2 || state.inningsComplete) return false;
  return [inn.striker, inn.nonStriker].some(i => i === inn.nextBat - 1 && inn.batters[i].balls === 0 && !inn.batters[i].out);
}
function setConnected(value) { connected = value; $('connection').textContent = value ? 'Desk connected' : 'Reconnecting…'; $('connection').classList.toggle('online', value); updateControls(); }
function fillForms() {
  const a = $('appearance-form'); for (const [key, value] of Object.entries(state.appearance)) { const input = a.elements.namedItem(key); if (!input) continue; if (input.type === 'checkbox') input.checked = value; else input.value = value; }
  $('scale-value').textContent = state.appearance.scale + '%';
  const cfg = state.config; if (cfg) for (const [key, value] of Object.entries(cfg)) { const input = $('setup-form').elements.namedItem(key); if (input) input.value = Array.isArray(value) ? value.join('\n') : value; }
}
function render(data) {
  if (state && data.revision < state.revision) return;
  state = data;
  $('summary-innings').value = data.appearance.summaryInnings;
  const summaryNames = {none: 'Scorebar only', scorecard: 'Innings scorecard on main source', match: 'Match summary on main source', bowling: 'Bowling analysis on main source'};
  $('summary-status').textContent = summaryNames[data.appearance.summaryType];
  document.querySelectorAll('[data-summary]').forEach(button => button.classList.toggle('on-air', button.dataset.summary === data.appearance.summaryType));
  renderTeamLogos();
  if (!initializedForms) { fillForms(); initializedForms = true; }
  if (!initialTab) { tab(data.active ? 'score' : 'setup'); initialTab = true; }
  const inn = data.current;
  $('saved-state').textContent = data.active ? 'Every accepted action is saved automatically' : 'Ready for your first match';
  if (inn) {
    $('innings-label').textContent = data.matchOver ? 'MATCH COMPLETE' : inn.number === 1 ? 'FIRST INNINGS' : 'THE CHASE';
    $('overs-limit').textContent = data.config.maxOvers + ' overs'; $('batting-name').textContent = inn.batting; $('versus').textContent = 'vs ' + inn.bowling;
    $('score').replaceChildren(document.createTextNode(inn.total), el('span', '/'), document.createTextNode(inn.wickets)); $('overs').textContent = overs(inn.legal) + ' overs';
    $('batters').replaceChildren(...[inn.striker, inn.nonStriker].map((index, i) => { const b = inn.batters[index], row = el('div', undefined, 'batter-row'); const figures = el('span', b.runs); figures.append(el('small', `(${b.balls})`)); row.append(el('span', b.name, i === 0 ? 'strike' : ''), figures); return row; }));
    const bowler = inn.bowlers[inn.bowler]; $('bowler-name').textContent = bowler?.name || 'Choose opening bowler'; $('bowler-figures').textContent = bowler ? `${overs(bowler.legal)}-${bowler.maidens}-${bowler.runs}-${bowler.wickets}` : '—';
    const tokens = inn.thisOver.length ? inn.thisOver : inn.completedOvers.at(-1)?.tokens || [];
    $('ticker').replaceChildren(...tokens.map(t => el('span', t, 'ball ' + (t.includes('W') ? 'wicket' : ['4', '6'].includes(t) ? 'boundary' : ''))));
    $('run-rate').textContent = 'CRR ' + (inn.legal ? inn.total * 6 / inn.legal : 0).toFixed(2);
    $('chase').hidden = inn.target === null;
    $('chase').textContent = data.result || (inn.target !== null ? `Target ${inn.target} · Need ${Math.max(0, inn.target - inn.total)} runs from ${Math.max(0, data.config.maxOvers * 6 - inn.legal)} balls` : '');
    const notice = $('match-notice'); notice.replaceChildren(); notice.hidden = false;
    if (data.matchOver) notice.textContent = data.result;
    else if (data.inningsComplete) { notice.append(el('strong', `${inn.batting} finish on ${inn.total}/${inn.wickets}.`)); const button = el('button', 'Start second innings →'); button.addEventListener('click', () => post('event', {event: {type: 'next'}})); notice.append(button); }
    else if (inn.awaitingBowler) { notice.append(el('span', inn.legal ? 'Over complete. Choose who bowls next.' : 'Choose the opening bowler to start scoring.')); const button = el('button', 'Select bowler'); button.addEventListener('click', chooseBowler); notice.append(button); }
    else notice.hidden = true;
    renderHistory(); renderScorecard();
  }
  updateControls();
}
function renderTeamLogos() {
  const labels = {home: 'Home team', away: 'Away team', channel: 'Channel - top right', sponsor: 'Sponsor - top left'};
  for (const side of ['home', 'away', 'channel', 'sponsor']) {
    const image = $(side + '-logo-preview'), placeholder = $(side + '-logo-placeholder');
    const src = state.appearance[side + 'Logo'] || '';
    $(side + '-logo-name').textContent = state.config?.[side] || labels[side];
    if (image.dataset.source !== src) {
      image.dataset.source = src; image.hidden = !src; placeholder.hidden = Boolean(src);
      image.parentElement.classList.toggle('video-logo', /\.(mp4|webm)$/.test(src));
      image.replaceChildren();
      if (src) {
        const media = createLogoMedia(src);
        media.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; placeholder.textContent = 'Could not play or display this logo'; });
        image.append(media);
      }
    }
  }
}
async function logoData(file, side) {
  const webm = file.type === 'video/webm' || /\.webm$/i.test(file.name);
  const video = webm || file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
  if (!video && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP image, H.264 MP4 or WebM video.');
  if (webm && !(await runtimeReady)?.webmLogos) throw new Error('Restart the scoreboard server and refresh this page to enable WebM logos.');
  if (video && !(await runtimeReady)?.videoLogos) throw new Error('Restart the scoreboard server and refresh this page to enable MP4 logos.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file no larger than 5 MB.');
  // The server permits data: images. FileReader avoids a blob: preview URL,
  // which is blocked by the image policy in already-running server instances.
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('This image could not be read.'));
    reader.onabort = () => reject(new Error('Image reading was cancelled.'));
    reader.readAsDataURL(file);
  });
  if (video) {
    const videoSource = (webm ? 'data:video/webm;base64,' : 'data:video/mp4;base64,') + source.slice(source.indexOf(',') + 1);
    const clip = createLogoMedia(videoSource); clip.autoplay = false; clip.preload = 'metadata';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Could not read the video. Use H.264 MP4 or VP8/VP9 WebM.')), 10000);
        clip.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        clip.onerror = () => { clearTimeout(timer); reject(new Error('Could not open the video. Use H.264 MP4 or VP8/VP9 WebM.')); };
        clip.src = videoSource;
      });
      if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 60) throw new Error('Video logos must be no longer than 60 seconds.');
      if (!clip.videoWidth || !clip.videoHeight || clip.videoWidth > 1920 || clip.videoHeight > 1080) throw new Error('Video logo resolution must be at most 1920 x 1080.');
      return videoSource;
    } finally { clip.pause(); clip.removeAttribute('src'); clip.load(); }
  }
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('This image could not be opened.')); image.src = source; });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('Choose an image with no more than 16 million pixels.');
  const canvas = document.createElement('canvas'), scale = Math.min(256 / image.naturalWidth, 256 / image.naturalHeight);
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  const teamLogo = side === 'home' || side === 'away';
  canvas.width = teamLogo ? 256 : Math.max(1, Math.round(width));
  canvas.height = teamLogo ? 256 : Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return canvas.toDataURL('image/png');
}
document.querySelectorAll('[data-logo-upload]').forEach(button => button.addEventListener('click', () => $(button.dataset.logoUpload + '-logo-input').click()));
for (const side of ['home', 'away', 'channel', 'sponsor']) {
  $(side + '-logo-input').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    logoBusy = true; updateControls();
    try {
      const data = await logoData(file, side);
      if (await post('logo', {side, data})) toast('Logo updated on all displays.');
    }
    catch (error) { toast(error.message || 'Could not upload the logo.'); }
    finally { event.target.value = ''; logoBusy = false; updateControls(); }
  });
}
document.querySelectorAll('[data-logo-remove]').forEach(button => button.addEventListener('click', async () => { if (await post('logo', {side: button.dataset.logoRemove, data: null})) toast('Logo removed.'); }));
function renderHistory() {
  const rows = state.history.slice(-18).reverse();
  $('history').replaceChildren(...(rows.length ? rows.map(ball => { const b = el('button'); b.append(el('small', `INN ${ball.innings} · ${ball.position}`), document.createTextNode(ball.token)); b.title = 'Correct this delivery'; b.addEventListener('click', () => openEdit(ball)); return b; }) : [el('p', 'Your deliveries will appear here.', 'muted small')]));
}
function renderScorecard() {
  const out = $('scorecard'); out.replaceChildren();
  for (const inn of state.innings) {
    out.append(el('h3', `${inn.batting} · ${inn.total}/${inn.wickets} (${overs(inn.legal)} overs)`));
    const table = el('table'), head = el('thead'), tr = el('tr'); for (const title of ['BATTER', 'DISMISSAL', 'R', 'B', '4s', '6s']) tr.append(el('th', title)); head.append(tr); table.append(head);
    const body = el('tbody'); inn.batters.forEach((b, index) => { const row = el('tr'); const played = b.balls > 0 || b.runs > 0 || b.out || index < inn.nextBat; for (const value of [b.name, b.out || (played ? 'not out' : inn.ended || inn.wickets >= 10 || inn.legal >= state.config.maxOvers * 6 || (inn.target !== null && inn.total >= inn.target) ? 'did not bat' : 'yet to bat'), b.runs, b.balls, b.fours, b.sixes]) row.append(el('td', value)); body.append(row); }); table.append(body); out.append(table, el('p', `Extras ${inn.extras} · Partnership ${inn.partnershipRuns} (${inn.partnershipBalls} balls)`, 'small muted'));
    const bowling = el('table'), bh = el('tr'); for (const title of ['BOWLER', 'O', 'M', 'R', 'W']) bh.append(el('th', title)); const bhead = el('thead'); bhead.append(bh); bowling.append(bhead); const bb = el('tbody');
    Object.values(inn.bowlers).forEach(b => { const row = el('tr'); for (const value of [b.name, overs(b.legal), b.maidens, b.runs, b.wickets]) row.append(el('td', value)); bb.append(row); }); bowling.append(bb); out.append(bowling);
  }
}
function openDialog(title, content) { $('action-title').textContent = title; $('action-content').replaceChildren(content); if (!$('action-dialog').open) $('action-dialog').showModal(); }
$('close-dialog').addEventListener('click', () => { $('action-dialog').close(); editing = null; });
$('action-dialog').addEventListener('cancel', () => editing = null);
function choices(title, options) { const box = el('div', undefined, 'choice-grid'); for (const [label, onClick] of options) { const button = el('button', label); button.addEventListener('click', onClick); box.append(button); } openDialog(title, box); }
async function record(event) {
  const result = editing === null ? await post('event', {event: {type: 'ball', ...event}}) : await post('edit', {index: editing, event}, editingRevision);
  if (!result && editing !== null && state.revision !== editingRevision) { editing = null; $('action-dialog').close(); }
  if (result) { editing = null; $('action-dialog').close(); }
}
function chooseBowler() { choices('Who bowls next?', state.current.fielders.map(name => [name, async () => { if (await post('event', {event: {type: 'bowler', name}})) $('action-dialog').close(); }])); }
$('choose-bowler').addEventListener('click', chooseBowler);
$('choose-batter').addEventListener('click', () => { choices('Choose the new batter', state.current.batters.slice(state.current.nextBat).map(b => [b.name, async () => { if (await post('event', {event: {type: 'batter', name: b.name}})) $('action-dialog').close(); }])); });
document.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => { editing = null; record({kind: 'run', runs: Number(b.dataset.run)}); }));
function extras(kind) { const names = {wide: 'Wide', noball: 'No ball', bye: 'Byes', legbye: 'Leg byes'}; const values = ['bye', 'legbye'].includes(kind) ? [1, 2, 3, 4] : [0, 1, 2, 3, 4, 6]; choices(names[kind], values.map(runs => [kind === 'wide' ? runs ? `Wide + ${runs} completed` : 'Wide · 1 extra' : kind === 'noball' ? runs ? `No ball + ${runs} off bat` : 'No ball · 1 extra' : `${runs} ${names[kind].toLowerCase()}`, () => record({kind, runs})])); }
document.querySelectorAll('[data-extra]').forEach(b => b.addEventListener('click', () => { editing = null; extras(b.dataset.extra); }));
function wicket() {
  const form = el('form');
  function field(label, element) { const l = el('label', label); l.append(element); form.append(l); return element; }
  const dismissal = el('select'); dismissal.name = 'dismissal'; for (const value of ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket']) { const o = el('option', value); o.value = value; dismissal.append(o); } field('Dismissal', dismissal);
  const fielder = el('select'); fielder.name = 'fielder'; const none = el('option', 'Not specified'); none.value = ''; fielder.append(none); for (const name of state.current.fielders) fielder.append(el('option', name)); field('Fielder (optional)', fielder);
  const runs = el('input'); runs.type = 'number'; runs.min = 0; runs.max = 6; runs.value = 0; runs.name = 'runs'; runs.disabled = true; field('Completed runs before run out', runs);
  const end = el('select'); for (const [value, label] of [['striker', 'Striker'], ['nonStriker', 'Non-striker']]) { const o = el('option', label); o.value = value; end.append(o); } end.disabled = true; field('Batter dismissed', end);
  dismissal.addEventListener('change', () => { runs.disabled = end.disabled = dismissal.value !== 'run out'; if (runs.disabled) { runs.value = 0; end.value = 'striker'; } });
  form.append(el('p', 'For unusual combinations such as a wicket on a no ball, use your official scorebook and correct this display as needed.', 'muted small'));
  const submit = el('button', 'Record wicket', 'danger full'); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', event => { event.preventDefault(); record({kind: 'wicket', dismissal: dismissal.value, runs: Number(runs.value), fielder: fielder.value, nonStriker: end.value === 'nonStriker'}); });
  openDialog(editing === null ? 'Record a wicket' : 'Correct delivery · wicket', form);
}
$('wicket').addEventListener('click', () => { editing = null; wicket(); });
function openEdit(ball) { editing = ball.index; editingRevision = state.revision; choices(`Correct innings ${ball.innings} · ${ball.position}`, [...[0, 1, 2, 3, 4, 5, 6].map(runs => [runs ? `${runs} run${runs === 1 ? '' : 's'}` : 'Dot ball', () => record({kind: 'run', runs})]), ...['wide', 'noball', 'bye', 'legbye'].map(kind => [kind === 'noball' ? 'No ball' : kind, () => extras(kind)]), ['Wicket', wicket]]); }
$('undo').addEventListener('click', async () => { if (await post('undo')) toast('Last scoring action undone.'); });
$('swap').addEventListener('click', () => post('event', {event: {type: 'swap'}}));
$('end-innings').addEventListener('click', () => { if (confirm('End this innings now? You can undo this action.')) post('event', {event: {type: 'end'}}); });
$('setup-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.active && !confirm('Start a new match? The current match will be archived.')) return;
  const form = new FormData(event.currentTarget), config = Object.fromEntries(form);
  config.maxOvers = Number(config.maxOvers); for (const key of ['homeXI', 'awayXI']) config[key] = config[key].split(/\r?\n/).map(n => n.trim()).filter(Boolean);
  if (await post('setup', {config, replace: state.active})) { tab('score'); toast('Match ready. Choose the opening bowler.'); }
});
$('appearance-form').elements.scale.addEventListener('input', event => $('scale-value').textContent = event.target.value + '%');
$('appearance-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, appearance = Object.fromEntries(new FormData(form));
  for (const key of ['visible', 'ticker', 'flash', 'channelVisible', 'sponsorVisible']) appearance[key] = form.elements.namedItem(key).checked;
  for (const key of ['scale', 'bottom', 'side', 'teamLogoSize', 'channelLogoWidth', 'sponsorLogoWidth', 'channelLogoTop', 'sponsorLogoTop', 'channelLogoSide', 'sponsorLogoSide']) appearance[key] = Number(appearance[key]);
  if (await post('appearance', {appearance})) toast('Overlay appearance updated.');
});
$('overlay-url').value = location.origin + '/overlay';
document.querySelectorAll('[data-summary-link]').forEach(link => link.href = location.origin + '/overlay?view=' + link.dataset.summaryLink);
for (const mode of ['scorecard', 'match', 'bowling']) $(mode + '-url').value = location.origin + '/overlay?view=' + mode;
document.querySelectorAll('[data-copy-summary]').forEach(button => button.addEventListener('click', async () => {
  const input = $(button.dataset.copySummary + '-url');
  try { await navigator.clipboard.writeText(input.value); toast('OBS source URL copied.'); }
  catch { input.select(); toast('Select and copy this OBS source URL.'); }
}));
document.querySelectorAll('[data-summary]').forEach(button => button.addEventListener('click', () => post('appearance', {appearance: {summaryType: button.dataset.summary, summaryInnings: $('summary-innings').value}})));
$('summary-innings').addEventListener('change', event => post('appearance', {appearance: {summaryInnings: event.target.value}}));
$('copy-url').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('overlay-url').value); toast('Overlay URL copied.'); } catch { $('overlay-url').select(); toast('Select and copy this overlay URL.'); } });
$('export').addEventListener('click', async () => {
  try { const response = await fetch('/api/export', {headers: {Authorization: 'Bearer ' + token}}); if (response.status === 401) { showLogin(); return; } if (!response.ok) throw new Error(); const blob = await response.blob(), url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = 'cricket-match.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { toast('Could not export the match.'); }
});
runtimeReady.then(info => {
  if (!info) return;
  $('network-info').textContent = info.addresses.length ? 'On the same network, open: ' + info.addresses.map(ip => `http://${ip}:${info.port}`).join(' or ') : 'No LAN address detected. Connect this computer to your private network.';
  const events = new EventSource('/api/events');
  events.onmessage = event => { try { const data = JSON.parse(event.data); setConnected(true); render(data); } catch (error) { console.error(error); toast('Could not read a score update. Refresh the page.'); } };
  events.onerror = () => setConnected(false);
  if (!token) showLogin();
  else fetch('/api/session', {headers: {Authorization: 'Bearer ' + token}}).then(r => { if (r.status === 401) showLogin(); else $('logout').hidden = false; }).catch(() => toast('Could not verify your session.'));
});
