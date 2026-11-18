# Admin navigation: Security, App & Updates and Admin moved out of Settings

App version NOT changed (no package.json in this bundle).

## What admins see now
Sidebar, Admin section, top to bottom:  Security  ·  App & Updates  ·  Admin Panel  ·  Audit Log  ·  Error Log
- Security: your own password and sign-in settings (the old Settings > Security tab).
- App & Updates: version, check for updates, update now (the old Settings > App & Updates tab). It shows a "1" badge when an update is waiting.
- Admin Panel: the old Settings > Admin tab (member management and group settings). Named "Admin Panel" because a menu item
  called just "Admin" inside the Admin group read oddly. Easy to rename: label in `ADMIN_ITEMS`, title in `src/lib/settingsSections.js`.
- Settings now shows an admin only Profile and Notifications.
- Old links still work: an admin opening /settings?tab=security (or updates, admin) is sent to the new page.

## What members see (unchanged)
Settings with Profile, Notifications, Security and App & Updates. Members do not get the new menu items, and the Admin Panel
page sends a member back to Settings (its content was already admin-only in code).
Reason for not moving Security and App & Updates for members as well: they are the only place a member can change their
password or update the app, and members have no Admin section.

## Files
New: src/lib/settingsSections.js (the redirect rules, so they can be tested)
Changed: src/pages/SettingsPage.jsx, src/components/AppShell.jsx, src/App.jsx   (+ tests/nav/nav.test.mjs)

## IMPORTANT: which files to copy
My copies of SettingsPage.jsx and App.jsx ALSO contain the changes from the nitalink_security bundle (secure add-member,
Forgot password). If you have NOT deployed that bundle and its `admin-create-member` function yet, do NOT copy those two
whole files; apply `patches/*.diff` instead. The diffs apply cleanly both with and without the security bundle.
  patch -p1 < patches/src_pages_SettingsPage.jsx.diff       (or: git apply patches/src_pages_SettingsPage.jsx.diff)

## Verified
16 checks (node tests/nav/nav.test.mjs, from the project root): redirect rules incl. "no loops" and "a page refresh never
bounces an admin while the profile loads"; sidebar order; routes; member menu unchanged; tab lists for admins vs members;
admin content still guarded by isAdmin; no remaining links to the moved tabs. Syntax, imports and undefined-name checks pass.
NOT verified: how it looks in a browser (spacing of the sidebar items, the standalone pages' headers).
On a phone, admins reach the new items through the menu drawer; the bottom bar is unchanged.
