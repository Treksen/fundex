// Run from the project root:  node tests/nav/nav.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settingsRedirect, ADMIN_SECTION_PATHS, SECTION_TITLES } from '../../src/lib/settingsSections.js'
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const shell = src('src/components/AppShell.jsx'), app = src('src/App.jsx'), settings = src('src/pages/SettingsPage.jsx')
let n = 0; const test = (name, fn) => { fn(); console.log('PASS', ++n, name) }
const items = (name) => [...shell.match(new RegExp(`const ${name} = \\[(.*?)\\n\\]`, 's'))[1].matchAll(/path: '([^']+)'[^}]*label: '([^']+)'/g)].map((m) => ({ path: m[1], label: m[2] }))
const R = (o) => settingsRedirect({ profileLoaded: true, isAdmin: false, ...o })

test('REDIRECT: admin opening an old Settings link for a moved section is sent to the new page', () => {
  assert.equal(R({ isAdmin: true, requestedTab: 'security' }), '/security'); assert.equal(R({ isAdmin: true, requestedTab: 'updates' }), '/updates'); assert.equal(R({ isAdmin: true, requestedTab: 'admin' }), '/admin') })
test('REDIRECT: admin on Settings with notifications/profile/no tab stays (notification links keep working)', () => {
  assert.equal(R({ isAdmin: true, requestedTab: 'notifications' }), null); assert.equal(R({ isAdmin: true, requestedTab: null }), null); assert.equal(R({ isAdmin: true, requestedTab: 'nonsense' }), null) })
test('REDIRECT: a MEMBER keeps Security and App & Updates inside Settings (never redirected)', () => {
  for (const t of ['security', 'updates', 'notifications', null]) assert.equal(R({ requestedTab: t }), null) })
test('REDIRECT: a member who reaches /admin is sent back to Settings; an admin stays', () => { assert.equal(R({ section: 'admin' }), '/settings'); assert.equal(R({ section: 'admin', isAdmin: true }), null) })
test('REDIRECT: Security / App & Updates pages never bounce anyone (member or admin)', () => { for (const s of ['security', 'updates']) for (const a of [true, false]) assert.equal(R({ section: s, isAdmin: a }), null) })
test('REDIRECT: while the profile is still loading nothing happens (a page refresh must not bounce an admin)', () => {
  assert.equal(settingsRedirect({ section: 'admin', isAdmin: false, profileLoaded: false }), null); assert.equal(settingsRedirect({ section: null, requestedTab: 'updates', isAdmin: false, profileLoaded: false }), null) })
test('REDIRECT: no loops. Following any redirect lands somewhere that does not redirect again', () => {
  for (const isAdmin of [true, false]) for (const tab of ['security', 'updates', 'admin', 'notifications', null]) {
    const first = R({ isAdmin, requestedTab: tab }); if (!first) continue
    const section = Object.entries(ADMIN_SECTION_PATHS).find(([, p]) => p === first)[0]; assert.equal(R({ isAdmin, section }), null, `${tab} -> ${first} loops`) }
  const toSettings = R({ section: 'admin' }); assert.equal(toSettings, '/settings'); assert.equal(R({ section: null, requestedTab: null }), null) })

test('SIDEBAR: Admin section is Security, App & Updates, Admin Panel, then Audit Log, then Error Log', () => {
  assert.deepEqual(items('ADMIN_ITEMS').map((i) => i.label), ['Security', 'App & Updates', 'Admin Panel', 'Audit Log', 'Error Log']) })
test('SIDEBAR: the new items point at the routes the redirect rules use', () => {
  const m = Object.fromEntries(items('ADMIN_ITEMS').map((i) => [i.label, i.path])); assert.equal(m['Security'], ADMIN_SECTION_PATHS.security); assert.equal(m['App & Updates'], ADMIN_SECTION_PATHS.updates); assert.equal(m['Admin Panel'], ADMIN_SECTION_PATHS.admin) })
test('SIDEBAR: members\' menu is unchanged (still has Settings, none of the admin items)', () => {
  const member = items('NAV_ITEMS').map((i) => i.path); assert.ok(member.includes('/settings')); for (const p of Object.values(ADMIN_SECTION_PATHS)) assert.ok(!member.includes(p), `${p} leaked into the member menu`)
  assert.ok(items('BOTTOM_NAV').some((i) => i.path === '/settings')) })
test('SIDEBAR: the admin group is only rendered for admins, and the update badge is wired', () => { assert.match(shell, /\{isAdmin && \(\s*<>\s*<span className="nav-section-label"[^>]*>Admin<\/span>\s*\{ADMIN_ITEMS\.map/s); assert.match(shell, /item\.path === '\/updates' && needRefresh/) })
test('ROUTES: each new path renders the Settings page with the matching section', () => {
  for (const [section, path] of Object.entries(ADMIN_SECTION_PATHS)) assert.ok(app.includes(`<Route path="${path.slice(1)}" element={<SettingsPage section="${section}" />} />`), `route for ${path}`)
  assert.ok(app.includes('<Route path="settings" element={<SettingsPage />} />')); assert.equal(Object.keys(SECTION_TITLES).sort().join(), Object.keys(ADMIN_SECTION_PATHS).sort().join()) })
test('SETTINGS: admins see only Profile + Notifications tabs; members see all four', () => {
  const ids = [...settings.match(/const TABS = \[(.*?)\n  \];/s)[1].matchAll(/id: "(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(ids.filter((i) => i !== 'admin'), ['profile', 'notifications', 'security', 'updates'])
  const adminTabs = ids.filter((t) => !['security', 'updates', 'admin'].includes(t)); assert.deepEqual(adminTabs, ['profile', 'notifications'])
  assert.ok(settings.includes("(isAdmin ? TABS.filter((t) => !['security', 'updates', 'admin'].includes(t.id)) : TABS).map")) })
test('SETTINGS: on a section page the profile card and tab bar are hidden, and the section is chosen by the route', () => {
  const a = settings.indexOf('{!section && ('), b = settings.indexOf('{/* Profile tab */}'); assert.ok(a > 0 && a < b)
  const wrapped = settings.slice(a, b); assert.ok(wrapped.includes('Profile header with photo upload') && wrapped.includes('.map((tab) =>')); assert.ok(!wrapped.includes('activeTab ===') || !/\{activeTab === "/.test(wrapped))
  assert.ok(settings.includes('const activeTab = section || tabState;')) })
test('SETTINGS: the admin content is still guarded by isAdmin, so a member can never see it even by URL', () => { assert.match(settings, /activeTab === "admin" && isAdmin && \(/) })
test('LINKS: nothing in the app still links admins to a moved Settings tab', () => {
  const files = ['src/components/AppShell.jsx', 'src/pages/DashboardPage.jsx', 'src/pages/GovernancePage.jsx', 'src/components/UpdateBanner.jsx']
  for (const f of files) { try { assert.doesNotMatch(src(f), /settings\?tab=(security|updates|admin)/) } catch (e) { if (e.code === 'ENOENT') continue; throw e } } })
console.log(`\nAll ${n} navigation tests passed`)
