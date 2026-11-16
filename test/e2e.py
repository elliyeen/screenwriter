"""End-to-end, accessibility and visual checks for Screenwriter.

Run:  npm run db:local && npx wrangler dev --local --port 8799 --test-scheduled   (in one terminal)
      python3 test/e2e.py                                                         (in another)
Needs: pip install playwright pillow, and Google Chrome. Set CHROME to its path if it is not /usr/bin/google-chrome.
Screenshots go to out/shots. The first run saves baselines in test/baseline; later runs compare against them.
"""
import json, os, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

B = os.environ.get('APP_URL', 'http://127.0.0.1:8799')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AXE = open(os.path.join(ROOT, 'node_modules/axe-core/axe.min.js')).read()
USER = 'writer%d@example.com' % int(time.time())
results, errors = [], []
ANA = 'ana%d@example.com' % int(time.time()); BEN = 'ben%d@example.com' % int(time.time())
FAKE_IP = '10.%d.%d.%d' % tuple(__import__('random').randint(1, 254) for _ in range(3))  # keeps repeated local runs from tripping the per-network limit

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS  ' if ok else 'FAIL  ') + name + ((' — ' + str(detail)) if detail and not ok else ''))

def ctx(b, w, h, mobile=False, user=USER):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    if user: c.add_cookies([{'name': 'dev_user', 'value': user, 'url': B}])
    p = c.new_page()
    p.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    p.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    p.on('dialog', lambda d: d.accept())
    return c, p

def api(path, user=USER):
    r = urllib.request.Request(B + path, headers={'cookie': 'dev_user=' + user})
    return json.load(urllib.request.urlopen(r))

def axe(page, name):
    page.evaluate(AXE)
    v = page.evaluate("axe.run(document, {runOnly: ['wcag2a', 'wcag2aa']}).then(r => r.violations.map(v => v.id + ' (' + v.nodes.length + '): ' + v.nodes[0].html.slice(0, 90)))")
    check('accessibility (WCAG A/AA, axe-core): ' + name, len(v) == 0, v)

def no_overflow(page, name):
    w = page.evaluate('[document.documentElement.scrollWidth, innerWidth]')
    check('no horizontal overflow: ' + name, w[0] <= w[1], w)

def shot(page, name):
    path = os.path.join(ROOT, 'out/shots', name + '.png')
    # cover shade comes from a random script id and the details panel shows a real clock time: pin both so the comparison is stable
    page.add_style_tag(content='.cover{background:#444!important}.drow:has(+ .drow), .drow:nth-of-type(n){--x:0}.details .drow span:last-child{visibility:hidden}')
    page.screenshot(path=path)
    base = os.path.join(ROOT, 'test/baseline', name + '.png')
    if not os.path.exists(base):
        Image.open(path).save(base); print('BASE  saved baseline ' + name); return
    a, b2 = Image.open(base).convert('RGB'), Image.open(path).convert('RGB')
    if a.size != b2.size: return check('visual regression: ' + name, False, 'size changed')
    diff = ImageChops.difference(a, b2).convert('L').point(lambda x: 255 if x > 24 else 0)
    changed = sum(diff.histogram()[255:]) / (a.size[0] * a.size[1])
    check('visual regression: %s (%.2f%% of pixels differ)' % (name, changed * 100), changed < 0.01)

FIXTURES = [('The Long Road', 'feature'), ('Night Shift', 'tv'), ('Paper Boats', 'short')]

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    c, p = ctx(b, 1440, 900)
    p.goto(B + '/'); p.wait_for_timeout(1500)

    # ---- layout ----
    cols = p.evaluate("getComputedStyle(document.getElementById('home')).gridTemplateColumns.split(' ').map(parseFloat)")
    check('three columns at 1440 (sidebar ~17%, details ~23%)', len(cols) == 3 and 0.14 < cols[0] / 1440 < 0.2 and 0.2 < cols[2] / 1440 < 0.26, cols)
    check('wordmark is text only, no logo image', p.locator('.wordmark img, .wordmark svg').count() == 0 and 'Screenwriter' in p.inner_text('.wordmark'))
    colors = p.evaluate("[...document.querySelectorAll('#home *:not(.cover):not(.cover *)')].flatMap(e => { const s = getComputedStyle(e); return [s.color, s.backgroundColor, s.borderTopColor]; }).filter(c => { const m = c.match(/\\d+/g); return m && Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2]) > 12; })")
    odd = [c for c in colors if not (lambda m: int(m[0]) > int(m[2]) and int(m[0]) >= int(m[1]))(__import__('re').findall(r'\d+', c))]
    check('one accent color only (orange) on top of black, white and grey', len(odd) == 0, odd[:3])
    check('library shows real data only (one starter script, no demo projects)', p.locator('.scard').count() == 1)

    # ---- slide-out sidebar ----
    w0 = p.evaluate("document.getElementById('libSide').getBoundingClientRect().width")
    p.click('#btnSide'); p.wait_for_timeout(500)
    w1 = p.evaluate("[document.getElementById('libSide').getBoundingClientRect().right, document.getElementById('libSide').inert, document.querySelector('.libmain').getBoundingClientRect().left]")
    check('sidebar slides out (hidden, not focusable, content uses the room)', w0 > 200 and w1[0] <= 1 and w1[1] and w1[2] <= 1, (w0, w1))
    p.reload(); p.wait_for_timeout(1200)
    check('sidebar stays hidden after reload', p.evaluate("document.getElementById('libSide').inert") and p.get_attribute('#btnSide', 'aria-expanded') == 'false')
    p.click('#btnSide'); p.wait_for_timeout(500)
    check('sidebar slides back in', p.evaluate("document.getElementById('libSide').getBoundingClientRect().width") > 200 and not p.evaluate("document.getElementById('libSide').inert"))

    # ---- typography: Inter for the app, Courier Prime for the page ----
    fam = p.evaluate("[getComputedStyle(document.body).fontFamily, getComputedStyle(document.querySelector('.banner h1')).fontFamily]")
    check('app text uses Inter', all(f.startswith('Inter') for f in fam), fam)
    loaded = p.evaluate("Promise.all([...['400','500','600'].map(w => document.fonts.load(w + ' 16px Inter')), document.fonts.load('16px \"Courier Prime\"')]).then(r => r.every(x => x.length > 0))")
    check('Inter (400/500/600) and Courier Prime are self-hosted and loaded', loaded)
    w = p.evaluate("(() => { const s = document.createElement('span'); s.style.cssText = 'font:12pt \"Courier Prime\";position:absolute;visibility:hidden;white-space:pre'; s.textContent = 'M'.repeat(60); document.body.appendChild(s); const r = s.getBoundingClientRect().width; s.remove(); return r; })()")
    check('Courier Prime 12pt is 10 characters per inch (60 chars = 6.00in within 0.1%)', abs(w - 576) < 0.6, w)
    ext = p.evaluate("performance.getEntriesByType('resource').filter(r => /fonts\\.(googleapis|gstatic)|fonts\\.bunny/.test(r.name)).length")
    check('no fonts loaded from outside servers', ext == 0)

    # ---- create scripts (test fixtures for this throwaway user) ----
    for title, typ in FIXTURES:
        p.click('#btnNew'); p.wait_for_timeout(250)
        p.click('#editor'); p.keyboard.press('Control+a'); p.keyboard.type('Title: %s\nAuthor: Test\n\nINT. ROOM - DAY\n\nSomeone waits.\n' % title, delay=0)
        p.wait_for_timeout(300); p.click('#btnHome'); p.wait_for_timeout(400)
        p.select_option('#dType', typ); p.wait_for_timeout(200)
    check('New Script creates scripts', p.locator('.scard').count() == 3, p.locator('.scard .ct').all_inner_texts())
    check('page count and type on card', 'TV Series • 1 page' in p.inner_text('.scard:has-text("Night Shift")'))

    # ---- select, details, open ----
    p.click('.scard:has-text("The Long Road")'); p.wait_for_timeout(200)
    check('click selects and fills details', 'The Long Road' in p.inner_text('#details h2') and p.locator('.scard.sel').count() == 1)
    p.dblclick('.scard:has-text("The Long Road") .cbody'); p.wait_for_timeout(400)
    check('double-click opens the editor', p.is_visible('#editor') and 'The Long Road' in p.input_value('#editor'))
    p.click('#btnHome'); p.wait_for_timeout(300)
    p.click('#dOpen'); p.wait_for_timeout(300)
    check('Open in Writer opens the editor', p.is_visible('#editor'))
    p.click('#btnHome'); p.wait_for_timeout(300)

    # ---- search, folders, pills, sort, view ----
    p.fill('#q', 'paper'); p.wait_for_timeout(200)
    check('search filters the library', p.locator('.scard').count() == 1 and 'Paper Boats' in p.inner_text('.scard'))
    p.fill('#q', ''); p.wait_for_timeout(200)
    p.click('#libFolders [data-nav="type:tv"]'); p.wait_for_timeout(200)
    check('folder filters scripts', p.locator('.scard .ct').all_inner_texts() == ['Night Shift'])
    p.click('#pills [data-filter="short"]'); p.wait_for_timeout(200)
    check('filter pill works', p.locator('.scard .ct').all_inner_texts() == ['Paper Boats'])
    p.click('#libNav [data-nav="library"]'); p.select_option('#sortSel', 'title'); p.wait_for_timeout(200)
    t = p.locator('.scard .ct').all_inner_texts()
    check('sort by title', t == sorted(t), t)
    p.select_option('#sortSel', 'edited')
    p.click('#modeSeg [data-mode=list]'); p.wait_for_timeout(200)
    check('list view', p.evaluate("document.getElementById('grid').classList.contains('list')"))
    p.click('#modeSeg [data-mode=grid]')

    # ---- rename, duplicate, favorite, milestones ----
    p.click('.scard:has-text("Paper Boats") .dots'); p.click('#ctx [data-act=rename]'); p.fill('#renameInput', 'Paper Planes'); p.click('#renameForm button'); p.wait_for_timeout(300)
    check('rename', p.locator('.scard:has-text("Paper Planes")').count() == 1)
    p.click('.scard:has-text("Paper Planes") .dots'); p.click('#ctx [data-act=dup]'); p.wait_for_timeout(300)
    check('duplicate', p.locator('.scard:has-text("Paper Planes (copy)")').count() == 1)
    p.click('.scard:has-text("Night Shift")'); p.click('#dFav'); p.wait_for_timeout(200)
    p.click('#libNav [data-nav=favorites]'); p.wait_for_timeout(200)
    check('favorites', p.locator('.scard .ct').all_inner_texts() == ['Night Shift'])
    p.click('#libNav [data-nav=library]'); p.click('.scard:has-text("Night Shift")')
    check('no progress ring until a milestone is recorded', p.locator('.scard:has-text("Night Shift") .ring').count() == 0)
    p.check('[data-ms=outline]'); p.wait_for_timeout(200); p.check('[data-ms=first]'); p.wait_for_timeout(300)
    check('progress ring from recorded milestones', '50%' in p.inner_text('.scard:has-text("Night Shift") .ring'))

    # ---- keyboard ----
    p.locator('.scard').first.focus(); first = p.locator('.scard.sel .ct').inner_text()
    p.keyboard.press('ArrowRight'); p.wait_for_timeout(150)
    check('arrow keys move the selection', p.locator('.scard.sel .ct').inner_text() != first)
    p.keyboard.press('Enter'); p.wait_for_timeout(300)
    check('Enter opens the selected script', p.is_visible('#editor'))
    p.click('#btnHome'); p.wait_for_timeout(300)
    p.keyboard.press('Control+k')
    check('Ctrl/Cmd+K focuses search', p.evaluate("document.activeElement.id") == 'q')

    # ---- export ----
    p.click('.scard:has-text("The Long Road")')
    with p.expect_download() as d: p.click('#dExport')
    f = d.value.path(); check('Export gives a PDF', open(f, 'rb').read(5) == b'%PDF-')
    with p.expect_download() as d: p.click('#avatar'); p.click('#btnZip')
    check('Download all scripts gives a zip', open(d.value.path(), 'rb').read(2) == b'PK')

    # ---- trash and restore ----
    p.wait_for_timeout(2500)
    p.click('.scard:has-text("Paper Planes (copy)") .dots'); p.click('#ctx [data-act=trash]'); p.wait_for_timeout(1500)
    check('trash hides the script', p.locator('.scard:has-text("Paper Planes (copy)")').count() == 0)
    row = [s for s in api('/api/scripts')['scripts'] if s['title'] == 'Paper Planes (copy)']
    check('trashed script is kept on the server, not erased', len(row) == 1 and row[0]['deleted'] == 1)
    p.click('#libNav [data-nav=trash]'); p.wait_for_timeout(200)
    check('trash lists it', p.locator('.scard:has-text("Paper Planes (copy)")').count() == 1)
    p.click('.scard:has-text("Paper Planes (copy)")'); p.click('#dRestore'); p.wait_for_timeout(1500)
    p.click('#libNav [data-nav=library]'); p.wait_for_timeout(200)
    check('restore brings it back', p.locator('.scard:has-text("Paper Planes (copy)")').count() == 1 and [s for s in api('/api/scripts')['scripts'] if s['title'] == 'Paper Planes (copy)'][0]['deleted'] == 0)

    # ---- top menu ----
    tabs = p.locator('#libTabs button').all_inner_texts()
    check('top menu is Library, Write, Outline, Marketplace (no Share, no Develop)', [t.lower().replace('soon', '').strip() for t in tabs] == ['library', 'write', 'outline', 'marketplace'], tabs)
    check('unavailable tabs are disabled and labeled', p.is_disabled('#libTabs [data-tab=market]') and 'soon' in p.inner_text('#libTabs [data-tab=market]').lower())

    # ---- remember your place across devices ----
    p.dblclick('.scard:has-text("The Long Road") .cbody'); p.wait_for_timeout(600)
    p.click('#editor'); p.keyboard.press('Control+End'); p.keyboard.type('MAYA\nHere is where I stopped.'); p.wait_for_timeout(2500)
    pos = p.evaluate("document.getElementById('editor').selectionStart")
    p.click('#btnHome'); p.wait_for_timeout(1200)
    c2, m = ctx(b, 390, 844, mobile=True)
    m.goto(B + '/'); m.wait_for_timeout(3000)
    check('second device shows the same scripts', m.locator('.scard').count() == p.locator('.scard').count())
    check('second device offers to continue', m.is_visible('#btnContinue') and 'The Long Road' in m.inner_text('#btnContinue'))
    m.click('#btnContinue'); m.wait_for_timeout(600)
    check('second device opens at the same spot', m.evaluate("document.getElementById('editor').selectionStart") == pos, (pos,))
    check('second device has the text typed on the first', 'Here is where I stopped.' in m.input_value('#editor'))

    # ---- offline: app opens, edits are kept, then sync ----
    m.wait_for_function("navigator.serviceWorker.ready.then(() => true)"); m.wait_for_timeout(1500)
    c2.set_offline(True)
    m.reload(); m.wait_for_timeout(1500)
    check('offline: the app still opens', m.locator('.scard').count() >= 4)
    m.click('.scard:has-text("Night Shift")'); m.wait_for_timeout(300); m.click('#dOpen'); m.wait_for_timeout(400)
    m.click('#editor'); m.keyboard.press('Control+End'); m.keyboard.type('\n\nTyped with no internet.'); m.wait_for_timeout(800)
    check('offline: status says so', 'Offline' in m.locator('#editorView [data-sync]').inner_text(), m.locator('#editorView [data-sync]').inner_text())
    m.reload(); m.wait_for_timeout(1200)
    check('offline: edits survive a reload', m.evaluate("JSON.parse(localStorage.getItem('screenwriter.v1')).scripts.some(s => s.text.includes('Typed with no internet.'))"))
    c2.set_offline(False); m.reload(); m.wait_for_timeout(4000)
    srv = [s for s in api('/api/scripts')['scripts'] if s['title'] == 'Night Shift'][0]
    check('back online: offline edits reach the cloud', 'Typed with no internet.' in api('/api/scripts/' + srv['id'])['text'])

    # ---- folder sync (same code path, using the browser's private file system as the folder) ----
    r = p.evaluate("""async () => { const f = await import('/js/folder.js'); const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('t' + Date.now(), {create: true});
      let names = await f.writeScripts(dir, [{id:'a1', title:'One: Two?', text:'Title: One'}, {id:'b2', title:'Other', text:'x'}], {});
      names = await f.writeScripts(dir, [{id:'a1', title:'Renamed', text:'Title: Renamed'}, {id:'b2', title:'Other', text:'x'}], names);
      const out = []; for await (const [n, h] of dir.entries()) out.push(n + '=' + await (await h.getFile()).text()); return out.sort(); }""")
    check('folder sync writes .fountain files and cleans up after a rename', r == ['Other.fountain=x', 'Renamed.fountain=Title: Renamed'], r)

    # ---- nightly backup ----
    urllib.request.urlopen(B + '/cdn-cgi/handler/scheduled?cron=0+9+*+*+*').read(); time.sleep(1.5)
    log = open('/tmp/wdev.log').read() if os.path.exists('/tmp/wdev.log') else ''
    check('nightly backup job ran and copied scripts', 'backup {"day"' in log and '"scripts":' in log, log[-300:])

    # ---- health check ----
    h = json.loads(urllib.request.urlopen(B + '/api/health').read())
    check('health check answers without signing in and reports the database', h.get('ok') is True and h.get('database') is True, h)

    # ---- sign in with an email code ----
    def post(path, body, hdr=None):
        rq = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'cf-connecting-ip': FAKE_IP, **(hdr or {})}, method='POST')
        try:
            r = urllib.request.urlopen(rq); return r.status, json.loads(r.read()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}'), e.headers
    ca, pa = ctx(b, 1280, 800, user='')  # no dev identity: a real visitor
    pa.set_extra_http_headers({'cf-connecting-ip': FAKE_IP})
    ca.clear_cookies()
    pa.goto(B + '/'); pa.wait_for_timeout(1500)
    check('signed out visitor sees the sign-in page, not scripts', pa.is_visible('#auth') and 'Sign in' in pa.inner_text('#aTitle'))
    axe(pa, 'sign-in page'); shot(pa, 'signin-desktop-1280')
    try: urllib.request.urlopen(B + '/api/scripts'); anon = 200
    except urllib.error.HTTPError as e: anon = e.code
    check('API refuses a visitor with no session (401)', anon == 401, anon)
    pa.fill('#aEmail', ANA)
    with pa.expect_response(lambda r: r.url.endswith('/api/auth/request')) as ri: pa.click('#aSend')
    code = ri.value.json().get('devCode')
    pa.wait_for_timeout(300)
    check('code step appears after asking for a code', pa.is_visible('#aCodeForm') and code and len(code) == 6, code)
    bad = '000000' if code != '000000' else '111111'
    pa.fill('#aCode', bad); pa.click('#aGo'); pa.wait_for_timeout(500)
    check('wrong code is refused with a clear message', pa.is_visible('#aCodeForm') and 'did not work' in pa.inner_text('#aMsg'))
    st, d, _ = post('/api/auth/request', {'email': ANA})
    check('asking again within a minute is rate limited (429)', st == 429, (st, d))
    pa.fill('#aCode', code); pa.click('#aGo'); pa.wait_for_timeout(2500)
    ck = {c['name']: c for c in ca.cookies()}.get('sw_session')
    check('correct code signs in and sets a secure session cookie', ck and ck['httpOnly'] and ck['sameSite'] == 'Lax', ck)
    check('signed in: library shows and account is named', not pa.is_visible('#auth') and pa.is_visible('#home'))
    pa.click('#avatar'); check('menu names the account', ANA in pa.inner_text('#whoami'))
    pa.click('#btnNew'); pa.wait_for_timeout(300)
    pa.click('#editor'); pa.keyboard.press('Control+a'); pa.keyboard.type('Title: Ana Private\n\nINT. ROOM - DAY\n\nSecret.\n', delay=0); pa.wait_for_timeout(2500)
    ana_cookie = '; '.join(c['name'] + '=' + c['value'] for c in ca.cookies())
    r = urllib.request.urlopen(urllib.request.Request(B + '/api/scripts', headers={'cookie': ana_cookie}))
    check('her script is saved to her account', any(s['title'] == 'Ana Private' for s in json.loads(r.read())['scripts']))
    # a second person cannot see it
    st, d2, _ = post('/api/auth/request', {'email': BEN})
    st, d3, h3 = post('/api/auth/verify', {'email': BEN, 'code': d2['devCode']})
    ben_cookie = h3.get('set-cookie').split(';')[0]
    r = urllib.request.urlopen(urllib.request.Request(B + '/api/scripts', headers={'cookie': ben_cookie}))
    check('another account cannot see her scripts', not any(s['title'] == 'Ana Private' for s in json.loads(r.read())['scripts']))
    st, _, _ = post('/api/auth/verify', {'email': BEN, 'code': d2['devCode']})
    check('a code works only once', st == 400, st)
    # wrong tries lock the code
    em = 'lock%d@example.com' % int(time.time())
    st, d4, _ = post('/api/auth/request', {'email': em})
    for i in range(5): post('/api/auth/verify', {'email': em, 'code': '999999' if d4['devCode'] != '999999' else '888888'})
    st, _, _ = post('/api/auth/verify', {'email': em, 'code': d4['devCode']})
    check('five wrong tries lock the code (even the right one fails)', st == 400, st)
    st, _, _ = post('/api/auth/request', {'email': 'not-an-email'})
    check('bad email is refused', st == 400)
    st, _, _ = post('/api/auth/request', {'email': 'x@example.com'}, {'origin': 'https://evil.example'})
    check('requests from another website are blocked (403)', st == 403, st)
    # sign out
    pa.click('#btnHome'); pa.wait_for_timeout(300); pa.click('#avatar'); pa.click('#btnSignOut'); pa.wait_for_timeout(2000)
    check('sign out returns to the sign-in page', pa.is_visible('#auth'))
    try: urllib.request.urlopen(urllib.request.Request(B + '/api/scripts', headers={'cookie': ana_cookie})); old = 200
    except urllib.error.HTTPError as e: old = e.code
    check('old session no longer works after sign out', old == 401, old)
    check('device copy is cleared after sign out', pa.evaluate("!(localStorage.getItem('screenwriter.v1') || '').includes('Ana Private')"))
    ca.close()

    # ---- screenshots, overflow, accessibility at the four sizes ----
    for name, w, h, mob in [('desktop-1440', 1440, 900, False), ('desktop-1280', 1280, 800, False), ('tablet-768', 768, 1024, False), ('mobile-390', 390, 844, True)]:
        cx, pg = ctx(b, w, h, mobile=mob)
        pg.add_init_script("Date.now = () => 1794900000000")  # freeze 'edited x ago' text for stable screenshots
        pg.goto(B + '/'); pg.wait_for_timeout(2500)
        if w > 1240: pg.click('.scard:has-text("Night Shift")'); pg.wait_for_timeout(200)
        no_overflow(pg, name + ' library'); axe(pg, name + ' library'); shot(pg, 'library-' + name)
        if w <= 1240:
            pg.click('.scard:has-text("Night Shift")'); pg.wait_for_timeout(500)
            check('details open on demand: ' + name, pg.evaluate("document.getElementById('details').classList.contains('open')"))
            shot(pg, 'details-' + name); pg.click('#dOpen')
        else: pg.click('#dOpen')
        pg.wait_for_timeout(700)
        no_overflow(pg, name + ' editor'); axe(pg, name + ' editor'); shot(pg, 'editor-' + name)
        cx.close()
    grid = None
    b.close()

check('no page or console errors', len(errors) == 0, errors[:4])
failed = [n for n, ok in results if not ok]
print('\n%d passed, %d failed' % (len(results) - len(failed), len(failed)))
sys.exit(1 if failed else 0)
