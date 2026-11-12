// Regression check for the single-page tracker (run before every publish).
// Simulates the shared database (persisted across reloads) and three people:
// the owner/staff (editor), a Fellow, and a second Fellow.
const { chromium, devices } = require('playwright');
const FILE = 'file://' + (process.argv[2] || '/tmp/claude-0/simple-test.html');
const mock = (uid, editor) => `(() => {
  window.__NOW = '2026-11-09T09:00';
  const load = () => JSON.parse(localStorage.getItem('mockdb') || '{}'); const save = (s) => localStorage.setItem('mockdb', JSON.stringify(s));
  const subs = [];
  const snap = (c) => { const st = load(); return { docs: Object.entries(st).filter(([k]) => k.split('/')[0] === c).map(([k, v]) => ({ id: k.split('/')[1], exists: true, data: () => v })) }; };
  const notify = () => subs.forEach(([c, fn]) => fn(snap(c)));
  window.addEventListener('storage', notify);
  const docRef = (p) => ({ set: async (d) => { const st = load(); st[p] = JSON.parse(JSON.stringify(d)); save(st); notify(); }, update: async (d) => { const st = load(); st[p] = { ...st[p], ...d }; save(st); notify(); }, delete: async () => { const st = load(); delete st[p]; save(st); notify(); } });
  const col = (c) => ({ orderBy() { return this; }, onSnapshot(fn) { subs.push([c, fn]); setTimeout(() => fn(snap(c)), 5); return () => {}; }, add: async (d) => { const st = load(); st[c + '/n' + Date.now()] = d; save(st); notify(); }, doc: (id) => docRef(c + '/' + id) });
  const user = { id: async () => '${uid}', isOwner: async () => ${editor}, canEdit: async () => ${editor}, profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: 'Person ' + i }])) };
  window.claude = { use: async (k) => ({ db: { collection: col, doc: docRef }, user, assets: ${editor} ? { upload: async () => ({ id: 'a'.repeat(32) }), delete: async () => {} } : null, downloads: { save: async (o) => { window.__dl = { name: o.filename, text: await o.data.text() }; } } }[k] ?? null) };
})();`;
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] }); // one browser profile = shared localStorage = shared "database"
  const page = async (uid, editor) => { const p = await ctx.newPage(); await p.addInitScript(mock(uid, editor)); p.on('pageerror', (e) => errs.push(uid + ': ' + e)); await p.goto(FILE); await p.waitForTimeout(400); return p; };
  // 1. staff first visit stores the schedule
  const staff = await page('u_staff', true);
  const st = () => staff.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '{}'));
  ok('Staff first visit saves the starting schedule', ((await st())['schedule/main'] || {}).events?.length === 25);
  ok('Staff sees tabs + backup button', (await staff.locator('#tabs').isVisible()) && (await staff.getByRole('button', { name: 'Download backup' }).isVisible()));
  // 2. a Fellow links their name
  const fel = await page('u_f3', false);
  ok('New Fellow sees "Which Fellow are you?"', await fel.getByText('Which Fellow are you?').isVisible());
  await fel.locator('[data-act=claim][data-f=f3]').click(); await fel.waitForTimeout(150);
  ok('Fellow linked and sees calendar, no tabs', (await fel.locator('#who-name').innerText()) === 'Fellow 03' && !(await fel.locator('#tabs').isVisible()));
  const fel2 = await page('u_f4', false);
  ok('Second Fellow cannot pick a taken name', await fel2.locator('[data-act=claim][data-f=f3]').isDisabled());
  await fel2.locator('[data-act=claim][data-f=f4]').click(); await fel2.waitForTimeout(100);
  // 3. Fellow records an absence -> saved -> staff sees it
  await fel.locator('.day', { hasText: /^17$/ }).first().click(); await fel.getByRole('radio', { name: 'Travel' }).click(); await fel.locator('#ab-note').fill('Back at 2'); await fel.getByRole('button', { name: 'Save absence' }).click(); await fel.waitForTimeout(150);
  ok('Fellow absence saved to their own record', JSON.stringify((await st())['absences/u_f3'] || {}).includes('Back at 2'));
  await staff.waitForTimeout(150);
  ok('Staff calendar shows 1 red dot on Nov 17', (await staff.locator('.day', { hasText: /^17$/ }).locator('.dots i.mine').count()) === 1);
  // 4. reload keeps it
  await fel.reload(); await fel.waitForTimeout(400);
  ok('After reload the Fellow still sees it (red date)', (await fel.locator('.day.missday', { hasText: /^17$/ }).count()) === 1);
  // 5. staff marks someone, edits schedule, report
  await staff.locator('.day', { hasText: /^17$/ }).first().click(); await staff.selectOption('#add-f', 'f4'); await staff.selectOption('#add-r', 'Illness'); await staff.locator('[data-act=staffadd]').click(); await staff.waitForTimeout(150);
  ok('Staff can mark another Fellow (saved in staff record)', !!(await st())['staffabs/f4']);
  await fel2.waitForTimeout(150);
  ok('That Fellow sees it on their calendar', (await fel2.locator('.day.missday', { hasText: /^17$/ }).count()) === 1);
  await staff.locator('[data-act=close]').click().catch(() => {});
  await staff.locator('[data-act=tab][data-v=update]').click(); await staff.locator('#view .ev').first().click(); await staff.locator('#ed-start').fill('12:30'); await staff.getByRole('button', { name: 'Save changes' }).click(); await staff.waitForTimeout(150);
  ok('Schedule edit saved for everyone', JSON.stringify((await st())['schedule/main']).includes('"12:30"'));
  await fel.waitForTimeout(150); await fel.locator('.day', { hasText: /^3$/ }).first().click();
  ok('Fellow sees the new time', (await fel.locator('.sheet .facts').innerText()).includes('12:30'));
  await fel.locator('[data-act=close]').click();
  await staff.locator('[data-act=tab][data-v=report]').click(); await staff.waitForTimeout(100);
  ok('Report totals: Fellow 03 = 1, Fellow 04 = 1', (await staff.locator('.panel .rrow', { hasText: 'Fellow 03' }).innerText()).trim().endsWith('1') && (await staff.locator('.panel .rrow', { hasText: 'Fellow 04' }).innerText()).trim().endsWith('1'));
  // 6. undo by Fellow
  await fel.locator('.day', { hasText: /^17$/ }).first().click(); await fel.locator('#layer').getByRole('button', { name: 'Undo' }).click(); await fel.waitForTimeout(150);
  await staff.waitForTimeout(150);
  ok('Fellow undo removes it for staff too', (await staff.locator('.panel .rrow', { hasText: 'Fellow 03' }).innerText()).trim().endsWith('0'));
  // 7. backup
  await staff.getByRole('button', { name: 'Download backup' }).click(); await staff.waitForTimeout(150);
  const bk = await staff.evaluate(() => window.__dl);
  ok('Backup file has schedule + absences + links', !!bk && /"claims"/.test(bk.text) && /"events"/.test(bk.text) && /"staffAbsences"/.test(bk.text), bk && bk.name);
  // 8. every screen + popup opens
  await staff.evaluate(() => { for (const t of ['roster', 'paste', 'feedback']) { sheet = { type: t }; renderSheet(); } sheet = { type: 'edit', id: EVENTS[0].id }; renderSheet(); sheet = { type: 'event', id: EVENTS[3].id }; renderSheet(); sheet = { type: 'daypick', d: '2026-11-19' }; renderSheet(); sheet = null; renderSheet(); });
  for (const t of ['cal', 'report', 'update']) { await staff.locator(`[data-act=tab][data-v=${t}]`).click(); await staff.waitForTimeout(40); }
  ok('Names & photos shows linked accounts', await staff.evaluate(() => { sheet = { type: 'roster' }; renderSheet(); const t = document.querySelector('.sheet').innerText; sheet = null; renderSheet(); return /Linked accounts/.test(t) && /Fellow 03/.test(t); }));
  for (const w of [320, 390]) { await staff.setViewportSize({ width: w, height: 700 }); for (const t of ['cal', 'report', 'update']) { await staff.locator(`[data-act=tab][data-v=${t}]`).click(); await staff.waitForTimeout(40); const sw = await staff.evaluate(() => document.documentElement.scrollWidth); if (sw > w) errs.push(`overflow ${w} ${t} ${sw}`); } }
  ok('No page errors / sideways scrolling', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
