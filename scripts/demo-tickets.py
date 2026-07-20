"""Stage the recording-day demo tickets. Run after reset-demo.ps1:

    python scripts/demo-tickets.py            # all seven
    python scripts/demo-tickets.py spanish tmp # just these
    python scripts/demo-tickets.py screenshot --screenshot my_error.png

The vision ticket uses scripts/QCerror.png (the real OMS QC error) by
default; --screenshot overrides, and a drawn placeholder covers a
missing file. Each ticket is bait for one demo beat (cheat sheet prints
at the end). Requires the API on :3001 and a live AI provider.
"""
import io, json, os, sys, time, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = 'http://localhost:3001'

def req(method, path, body=None, user='1'):
    headers = {'x-user-id': user}
    if body is not None: headers['content-type'] = 'application/json'
    r = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    return json.loads(urllib.request.urlopen(r).read() or b'{}')

def upload(ticket_id, filename, data, mime, user='1'):
    boundary = '----demotickets'
    body = (f'--{boundary}\r\ncontent-disposition: form-data; name="files"; filename="{filename}"\r\n'
            f'content-type: {mime}\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    r = urllib.request.Request(BASE + f'/api/tickets/{ticket_id}/attachments', method='POST', data=body,
        headers={'x-user-id': user, 'content-type': f'multipart/form-data; boundary={boundary}'})
    return json.loads(urllib.request.urlopen(r).read())

def repo_screenshot():
    """The real QC error screenshot that ships next to this script."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'QCerror.png')
    return p if os.path.isfile(p) else None

def default_screenshot() -> bytes:
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (560, 240), (246, 246, 248))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 560, 34], fill=(22, 33, 58))
    d.text((12, 10), 'OMS - Order Management', fill='white')
    d.text((530, 10), 'X', fill='white')
    d.rectangle([22, 62, 62, 102], outline=(200, 60, 60), width=3)
    d.text((37, 72), '!', fill=(200, 60, 60))
    d.text((84, 64), 'Runtime Error 429', fill=(30, 30, 30))
    d.text((84, 94), 'Connection pool exhausted - the pick screen could not load.', fill=(60, 60, 60))
    d.text((84, 114), 'Session: WH-PHX-STATION-04   Server: oms-app-02', fill=(60, 60, 60))
    d.rectangle([440, 190, 535, 220], fill=(22, 33, 58))
    d.text((470, 197), 'OK', fill='white')
    buf = io.BytesIO(); img.save(buf, 'PNG')
    return buf.getvalue()

users = req('GET', '/api/users')
requesters = [u for u in users if u.get('role') == 'requester']
def requester(i): return str(requesters[i % len(requesters)]['id'])

filed = []

def note(name, number, beat):
    filed.append((name, number, beat))
    print(f'  {number}  {name}')

# ---------------------------------------------------------------------------

def screenshot(image_path=None):
    data = open(image_path, 'rb').read() if image_path else default_screenshot()
    ext = (image_path.rsplit('.', 1)[-1].lower() if image_path and '.' in image_path else 'png')
    mime = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'}.get(ext, 'image/png')
    t = req('POST', '/api/tickets', {
        'subject': '', 'description': 'Keeps happening, screenshot attached. Please help.',
        'type': 'incident', 'holdTriage': True}, user=requester(0))
    upload(t['id'], f'error.{ext}', data, mime, user=requester(0))
    req('POST', f"/api/tickets/{t['id']}/triage-now", {}, user=requester(0))
    note('screenshot-only ticket', t['number'],
         'VISION: open it — subject written by AI, routed to MERP via the OMS glossary, summary quotes the QC error straight off the image')

def email():
    r = req('POST', '/api/mail/inbound', {
        'from': 'sofia.garcia@masterelectronics.com',
        'subject': 'Forklift charger at station 2 is dead',
        'body': 'The forklift charging station 2 on the east wall shows no lights and will not charge anything since this morning. We are rotating batteries through the other chargers but it is slowing the whole shift down.',
    })
    note('email ticket', r.get('number', '?'),
         'EMAIL: show it in the Email tab (ack thread + reply-token), then on the board — same pipeline as the portal')

def newhire():
    t = req('POST', '/api/tickets', {
        'subject': 'New hire setup — Maria Gonzalez starts August 3',
        'description': 'Maria Gonzalez joins the Purchasing team on Monday, August 3. She will need a laptop, MERP access, a desk phone extension, and a badge. Nothing is needed until the week before she starts.',
        'type': 'request'}, user=requester(1))
    note('August new hire', t['number'],
         'SNOOZE: drag to the Holding area, pick a late-July date on the calendar — "wakes Monday, Jul 27 at 8:00 AM"')

def tmp():
    t = req('POST', '/api/tickets', {
        'subject': "Can't get into the TMP drive",
        'description': 'The M drive (TMP folder) will not open on my machine since the update last night. I use it every day for label templates.',
        'type': 'incident'}, user=requester(2))
    note('TMP drive ticket', t['number'],
         'SEARCH KB: expand it, hit 📚 Search KB — the TMP/M-drive registry article is the top hit, expands inline')

def mention():
    t = req('POST', '/api/tickets', {
        'subject': 'Label printer acting up again at station 1',
        'description': 'Same printer problem as last month — labels come out blank every few jobs. Derek was helping me with this printer back then and knows the history.',
        'type': 'incident'}, user=requester(3))
    note('agent-mention ticket', t['number'],
         'MENTIONED: gold ring on Derek in Suggested; drag to Auto-assign (Mentioned) → "Assigned by mention: → Derek Ramirez"')

def autostore():
    t = req('POST', '/api/tickets', {
        'subject': 'AutoStore grid stopped — bin retrieval fault',
        'description': 'The AutoStore grid halted with a bin retrieval fault on robot 7. Port 3 is empty and picks routed to it are stacking up. Vendor error code R7-BIN-STUCK on the controller.',
        'type': 'incident'}, user=requester(4))
    note('AutoStore ticket', t['number'],
         "KEYWORD: Admin → Scoring → add keyword 'autostore' with a boost → watch this ticket's score jump on rescore")

def databricks():
    # Deliberately vague so SOTO has to ask its intake questions — the
    # on-camera beat is answering them in the portal and watching it route.
    t = req('POST', '/api/tickets', {
        'subject': 'Databricks problem',
        'description': "I'm having trouble in Databricks — there's a dataset I need for my weekly report and I can't get into it. Can someone help?",
        'type': 'request'}, user=requester(6))
    note('Databricks intake ticket', t['number'],
         'INTAKE: act as the requester in the portal — SOTO has posted its questions. Paste this reply:\n'
         '   "1. Yes, access issue. 2. No, never accessed it before. 3. Yes, it\'s new. 4. Yes — my team lead told me\n'
         '   to start using the sales_orders_gold table. 5. Yes, first attempt."\n'
         '   → routes to Data Team with the Question/Answer handoff table in the internal notes (agent view)')

def spanish():
    t = req('POST', '/api/tickets', {
        'subject': 'La impresora de etiquetas no funciona',
        'description': 'La impresora Zebra de la estación de empaque 3 no imprime nada desde esta mañana. Las órdenes se están acumulando y necesitamos enviar hoy. Ya la reinicié dos veces.',
        'type': 'incident'}, user=requester(5))
    note('Spanish ticket', t['number'],
         'BILINGUAL: agent sees the 🌐 translated block; reply in English → requester gets it back in Spanish')

# ---------------------------------------------------------------------------

SCENARIOS = {
    'screenshot': screenshot, 'email': email, 'newhire': newhire,
    'tmp': tmp, 'mention': mention, 'autostore': autostore,
    'databricks': databricks, 'spanish': spanish,
}
# The 15-minute live slot has room for every beat — stage all eight.
# (To cut for a shorter take, list names: python scripts/demo-tickets.py spanish tmp)
EXTRAS: list = []
DEFAULT = [k for k in SCENARIOS if k not in EXTRAS]

argv = sys.argv[1:]
img_path = None
if '--screenshot' in argv:
    i = argv.index('--screenshot')
    if i + 1 >= len(argv):
        print('--screenshot needs a file path'); sys.exit(1)
    img_path = argv[i + 1]
    del argv[i:i + 2]  # flag AND its value — neither is a scenario name
    if not os.path.isfile(img_path):
        print(f'screenshot not found: {img_path}'); sys.exit(1)
    print(f'using custom screenshot: {img_path}')
else:
    img_path = repo_screenshot()
    if img_path:
        print(f'using the repo QC error screenshot: {img_path}')
picked = argv or DEFAULT

print('Filing demo tickets…')
for name in picked:
    if name not in SCENARIOS:
        print(f'  unknown scenario: {name} (choices: {", ".join(SCENARIOS)})'); continue
    SCENARIOS[name](img_path) if name == 'screenshot' else SCENARIOS[name]()

print('\nWaiting for AI triage to land…')
time.sleep(25)

print('\n=== CHEAT SHEET ===')
for name, number, beat in filed:
    print(f'{number} — {beat}\n')
print('BONUS (no ticket needed) — RECURRING: Admin → AI & Automation → Recurring tickets,')
print('hit ▶ on "Monthly Zebra printer PM" to file a scheduled ticket live; it AI-triages like any other.')
if not argv and EXTRAS:
    print(f'\nCut for time (file by name if wanted): python scripts/demo-tickets.py {" ".join(EXTRAS)}')
print('\nTip: run this again after every reset-demo.ps1; numbers will differ per run.')
