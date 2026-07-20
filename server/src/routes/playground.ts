import type { FastifyInstance } from 'fastify';

/**
 * The API playground: a single self-contained HTML page that talks to the
 * public REST API exactly like any third-party integration would — an
 * admin-minted API key, plain fetch(), no framework, no build. Live-demo
 * companion to /api/docs: paste a ticket number, see the actual HTTP
 * calls, the parsed ticket, and the raw JSON; the Live toggle polls so a
 * reply sent in METS appears here seconds later.
 *
 * The page itself is unauthenticated static HTML (listed in the auth skip
 * set in index.ts) — every request IT makes carries the API key you paste.
 */

const PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>METS API playground</title>
<style>
  :root {
    --bg: #10151d; --card: #1a2230; --line: #2c3a4f; --ink: #e8edf4;
    --muted: #8b9bb0; --accent: #f5a83c; --ok: #4cc38a; --bad: #e5534b;
    --mono: ui-monospace, 'Cascadia Code', Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 system-ui, 'Segoe UI', sans-serif;
    display: flex; justify-content: center; padding: 28px 16px;
  }
  main { width: 100%; max-width: 760px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h1 .amp { color: var(--accent); }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 14px 16px; margin-bottom: 14px;
  }
  label { display: block; font-size: 11px; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); margin: 8px 0 3px; }
  input[type=text], input[type=password] {
    width: 100%; background: var(--bg); color: var(--ink);
    border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px;
    font-family: var(--mono); font-size: 14px;
  }
  input:focus { outline: 1px solid var(--accent); }
  .row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 160px; }
  button {
    background: var(--accent); color: #1a1408; border: 0; border-radius: 7px;
    padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  .live { display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; color: var(--muted); padding: 9px 4px; cursor: pointer; }
  #log { font-family: var(--mono); font-size: 12.5px; }
  #log div { padding: 2px 0; color: var(--muted); }
  #log .m { color: var(--accent); font-weight: 700; }
  #log .ok { color: var(--ok); } #log .bad { color: var(--bad); }
  dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 14px; margin: 0; }
  dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; padding-top: 2px; }
  dd { margin: 0; }
  .chip { display: inline-block; background: var(--bg); border: 1px solid var(--line);
    border-radius: 6px; padding: 1px 8px; font-size: 13px; margin-right: 6px; }
  .p1 { color: var(--bad); font-weight: 700; } .p2 { color: var(--accent); font-weight: 700; }
  .ai { border-left: 3px solid var(--accent); padding: 6px 10px; margin-top: 10px;
    background: var(--bg); border-radius: 0 7px 7px 0; font-size: 13.5px; }
  .ai .tag { color: var(--accent); font-weight: 700; font-size: 11px; }
  .comment { border-top: 1px dashed var(--line); margin-top: 10px; padding-top: 8px; font-size: 13.5px; }
  .comment .who { color: var(--muted); font-size: 12px; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 10px; font-size: 12px; overflow: auto; max-height: 380px; }
  .flash { animation: flash 1.2s ease; }
  @keyframes flash { from { background: rgba(245,168,60,.25); } to { background: transparent; } }
  .err { color: var(--bad); font-size: 14px; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 6px; }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>METS <span class="amp">API</span> playground</h1>
  <p class="sub">One HTML file. No framework, no build, no SDK — just the same
  keyed REST API any warehouse kiosk, Power BI extract, or script would use.</p>

  <div class="card">
    <div class="row">
      <div style="flex:2">
        <label>API key <span style="text-transform:none">(Admin &rarr; API keys &middot; stored in this browser only)</span></label>
        <input type="password" id="key" placeholder="mets_...">
      </div>
      <div>
        <label>Ticket number</label>
        <input type="text" id="num" placeholder="T-1000042 or INC0010081" autocomplete="off">
      </div>
      <div style="flex:0">
        <button id="go">Fetch</button>
      </div>
      <div style="flex:0">
        <label class="live"><input type="checkbox" id="livebox"> Live (3s)</label>
      </div>
    </div>
    <div id="log"></div>
  </div>

  <div class="card" id="out" hidden>
    <dl id="fields"></dl>
    <div id="aiPanel"></div>
    <div id="lastComment"></div>
    <details><summary>Raw JSON — what your integration actually receives</summary><pre id="raw"></pre></details>
  </div>
  <p class="err" id="err" hidden></p>

  <footer>Full spec at <a href="/api/docs">/api/docs</a> &middot; the key acts as its bound METS user — RBAC and queue visibility apply.</footer>
</main>
<script>
  var keyEl = document.getElementById('key');
  var numEl = document.getElementById('num');
  var goBtn = document.getElementById('go');
  var liveBox = document.getElementById('livebox');
  var logEl = document.getElementById('log');
  var outEl = document.getElementById('out');
  var errEl = document.getElementById('err');
  var lastJson = '';
  var timer = null;

  keyEl.value = localStorage.getItem('mets-api-key') || '';
  keyEl.addEventListener('change', function () { localStorage.setItem('mets-api-key', keyEl.value.trim()); });

  function logLine(method, path, status, ms) {
    var ok = status >= 200 && status < 300;
    var div = document.createElement('div');
    div.innerHTML = '<span class="m">' + method + '</span> ' + path +
      ' &rarr; <span class="' + (ok ? 'ok' : 'bad') + '">' + status + '</span> &middot; ' + ms + 'ms';
    logEl.appendChild(div);
    while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
  }

  function call(path) {
    var started = performance.now();
    return fetch(path, { headers: { 'x-api-key': keyEl.value.trim() } }).then(function (res) {
      logLine('GET', path, res.status, Math.round(performance.now() - started));
      if (!res.ok) throw new Error(res.status === 401 ? 'Unauthorized — check the API key' : 'HTTP ' + res.status);
      return res.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function field(dt, dd) { return '<dt>' + dt + '</dt><dd>' + dd + '</dd>'; }

  function render(t) {
    var json = JSON.stringify(t, null, 2);
    var changed = lastJson && json !== lastJson;
    lastJson = json;

    var prio = '<span class="p' + t.priority + '">P' + t.priority + '</span>';
    var html =
      field('Ticket', '<strong>' + esc(t.number) + '</strong>' + (t.legacyNumber ? ' <span class="chip">SNOW ' + esc(t.legacyNumber) + '</span>' : '')) +
      field('Subject', esc(t.subject)) +
      field('Status', '<span class="chip">' + esc(t.status && t.status.name) + '</span>' + prio + (t.score != null ? ' <span class="chip">score ' + t.score + '</span>' : '')) +
      field('Queue', esc(t.queue && t.queue.name) + (t.category ? ' &middot; ' + esc(t.category) : '')) +
      field('Requester', esc(t.requester && t.requester.name) + (t.assignee ? ' &rarr; assigned ' + esc(t.assignee.name) : ' &middot; unassigned'));
    document.getElementById('fields').innerHTML = html;

    var ai = t.ai && t.ai.result;
    document.getElementById('aiPanel').innerHTML = ai
      ? '<div class="ai"><span class="tag">&#10024; SOTO</span> ' + esc(ai.summary) +
        (t.ai.confidence ? ' <span class="chip">' + Math.round((t.ai.confidence.queue || 0) * 100) + '% queue confidence</span>' : '') +
        (ai.profileTier ? ' <span class="chip">' + esc(ai.profileTier) + ' profile</span>' : '') + '</div>'
      : (t.customFields && t.customFields.aiBypassRule
        ? '<div class="ai"><span class="tag">&#9889; RULE</span> routed without AI &mdash; matched &ldquo;' + esc(t.customFields.aiBypassRule) + '&rdquo;</div>' : '');

    var c = (t.comments || []).slice(-1)[0];
    document.getElementById('lastComment').innerHTML = c
      ? '<div class="comment"><span class="who">latest comment &middot; ' + esc(c.author && c.author.name) + ' &middot; ' + esc((c.createdAt || '').replace('T', ' ').slice(0, 16)) + '</span><br>' + esc(c.bodyText).slice(0, 300) + '</div>'
      : '';

    document.getElementById('raw').textContent = json;
    outEl.hidden = false;
    errEl.hidden = true;
    if (changed) { outEl.classList.remove('flash'); void outEl.offsetWidth; outEl.classList.add('flash'); }
  }

  function fetchTicket() {
    var num = numEl.value.trim();
    if (!num) return Promise.resolve();
    // Two calls, same as any integration: resolve the number, then pull detail.
    return call('/api/tickets?view=all&search=' + encodeURIComponent(num))
      .then(function (list) {
        var rows = Array.isArray(list) ? list : (list.tickets || []);
        var hit = rows.find(function (r) { return r.number === num.toUpperCase() || r.legacyNumber === num.toUpperCase(); }) || rows[0];
        if (!hit) throw new Error('No ticket matches "' + num + '"');
        return call('/api/tickets/' + hit.id);
      })
      .then(render)
      .catch(function (e) {
        errEl.textContent = e.message; errEl.hidden = false; outEl.hidden = true;
        liveBox.checked = false; setLive();
      });
  }

  function setLive() {
    if (timer) { clearInterval(timer); timer = null; }
    if (liveBox.checked) timer = setInterval(fetchTicket, 3000);
  }

  goBtn.addEventListener('click', function () { lastJson = ''; fetchTicket(); });
  numEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { lastJson = ''; fetchTicket(); } });
  liveBox.addEventListener('change', setLive);
</script>
</body>
</html>`;

export async function playgroundRoutes(app: FastifyInstance) {
  app.get('/api/playground', async (_req, reply) => reply.type('text/html').send(PLAYGROUND_HTML));
}
