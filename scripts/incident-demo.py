"""End-to-end demo/test of incident screen presence.

Simulates a Zoom outage and verifies the whole incident lifecycle in a
headless browser:

  1. Files 3 similar tickets as different requesters -> AI declares a
     major incident (declaration toast + app-wide red banner)
  2. Files a 4th report -> absorbed into the parent (toast, count ticks up)
  3. Switches to a requester -> portal shows the banner read-only
  4. Clicks the banner -> incident ticket opens
  5. Resolves the parent -> cascade closes all children with a SOTO
     comment, toast fires, banner clears
  6. Server-side check: a child is Resolved with the closing comment

Prereqs: API + web dev servers running, live AI provider (mock works but
routes by keyword), Python with playwright installed (`playwright install
chromium`). Takes 1-5 minutes depending on AI latency. Screenshots land
next to this script. Reseed afterward: `npm run db:seed` in server/.

  APP_URL / API_URL env vars override the defaults below.
"""
import io, json, os, sys, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

APP_URL = os.environ.get('APP_URL', 'http://mets.masterelectronics.com')
API_URL = os.environ.get('API_URL', 'http://localhost:3001')
SHOT = os.path.dirname(os.path.abspath(__file__))

def req(method, path, body=None, user='1'):
    r = urllib.request.Request(API_URL + path, method=method,
        data=json.dumps(body).encode() if body else None,
        headers={'x-user-id': user, 'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())

users = req('GET', '/api/users')
requesters = [u for u in users if u.get('role') == 'requester'][:4]

BURST = [
    ('Zoom meetings will not connect', 'Zoom errors out with code 5003 when joining any meeting. Restarted, no luck.'),
    ('Zoom call failed to connect', 'Every Zoom meeting fails to connect this morning with error 5003. Have a customer call at 10.'),
    ('Zoom down for our standup', 'Zoom client stuck on connecting for our whole team standup. Nobody could join.'),
]
FOURTH = ('Zoom not connecting for me either', 'Zoom keeps spinning on connect and then drops. Started about an hour ago.')

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={'width': 1600, 'height': 950})
    page.goto(APP_URL)
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(800)
    print('baseline banner (want 0):', page.locator('.incident-banner-item').count())

    toasts = set()
    def collect():
        for t in page.locator('.toast').all_inner_texts():
            toasts.add(t.strip())

    nums = []
    for (subj, desc), u in zip(BURST, requesters):
        t = req('POST', '/api/tickets', {'subject': subj, 'description': desc, 'type': 'incident'}, user=str(u['id']))
        nums.append(t['number'])
    print('burst filed:', nums)

    # wait for declaration (triage x3 + incident AI; a transient AI failure
    # is retried after 20s, so give it room)
    for i in range(720):  # up to 6 min
        collect()
        if page.locator('.incident-banner-item').count() > 0:
            break
        page.wait_for_timeout(500)
    banner = page.locator('.incident-banner-item')
    declared_early = banner.count() > 0
    print('banner:', banner.inner_text().replace('\n', ' | ') if declared_early
          else 'not yet — the 4th report below can still trigger it')
    print('declaration toast:', next((t for t in toasts if 'Major incident declared' in t), '(missing)'))
    page.wait_for_timeout(1000); collect()
    page.screenshot(path=os.path.join(SHOT, 'incident_banner.png'))

    # 4th report: absorbed if the parent already exists, otherwise it becomes
    # the founding report that triggers the declaration
    t4 = req('POST', '/api/tickets', {'subject': FOURTH[0], 'description': FOURTH[1], 'type': 'incident'}, user=str(requesters[3]['id']))
    print('4th filed:', t4['number'])
    for i in range(360):  # up to 3 min
        collect()
        if any('absorbed another report' in t for t in toasts):
            break
        if not declared_early and banner.count() > 0:
            break
        page.wait_for_timeout(500)
    if declared_early:
        print('absorb toast:', next((t for t in toasts if 'absorbed another report' in t), '(missing)'))
    else:
        print('declared by 4th report:', banner.count() > 0)
    if banner.count() == 0:
        print('FAIL: no incident declared — check server logs for [incidents] errors')
        b.close(); sys.exit(1)
    print('banner now:', banner.inner_text().replace('\n', ' | '))

    # requester portal: banner visible, read-only
    page.locator('.user-switcher').select_option(label=requesters[0]['name'])
    page.wait_for_timeout(1500)
    pc = page.locator('.portal .incident-banner-item')
    print('portal banner:', pc.count(), '| read-only:', pc.first.is_disabled() if pc.count() else '-')
    page.screenshot(path=os.path.join(SHOT, 'incident_portal.png'))
    page.locator('.user-switcher').select_option(label='Justin Rhoda')
    page.wait_for_timeout(1500)

    # click banner -> incident detail expands
    page.locator('.incident-banner-item').click()
    page.locator('.detail-meta').wait_for(timeout=10000)
    print('detail opened via banner click: True')
    page.screenshot(path=os.path.join(SHOT, 'incident_detail.png'))

    # resolve the parent -> cascade
    page.locator('.detail-meta select').first.select_option(label='Resolved')
    for i in range(60):
        collect()
        if any('Incident resolved' in t for t in toasts):
            break
        page.wait_for_timeout(500)
    print('cascade toast:', next((t for t in toasts if 'Incident resolved' in t), '(missing)'))
    for i in range(40):
        if page.locator('.incident-banner-item').count() == 0:
            break
        page.wait_for_timeout(500)
    print('banner cleared:', page.locator('.incident-banner-item').count() == 0)
    page.screenshot(path=os.path.join(SHOT, 'incident_resolved.png'))
    print('--- all toasts seen ---')
    for t in sorted(toasts):
        print(' •', t.replace('\n', ' '))
    b.close()

# server-side child check: resolved + closing SOTO comment
lst = req('GET', '/api/tickets?view=closed&sort=newest&limit=30')
child = next((r for r in lst if r['number'] in nums or r['number'] == t4['number']), None)
if child:
    d = req('GET', f"/api/tickets/{child['id']}")
    print('child', d['number'], 'status:', d['status']['name'])
    last = d['comments'][-1]
    print('closing comment by', last['author']['name'], ':', last['bodyText'][:120].replace('\n', ' '))
else:
    print('NO closed child found')

print('\nDone. Reseed to baseline: cd server && npm run db:seed')
