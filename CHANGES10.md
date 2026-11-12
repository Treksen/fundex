# v1.5.1 — members' Settings, admin-only diagnostics, and getting every member onto the update banner

## 1. Settings for every member
`/settings` was never locked to admins, but the sidebar only listed it under the admin-only group.
It is now in the main menu for everyone. Members get Profile, Notifications, Security and App & Updates.
Audit Log and Error Log stay admin-only. (The mobile bottom bar already had Settings for everyone.)

## 2. Technical details and "How updates work" are admin-only
The diagnostic panel (service worker state + recent update events) and the "How updates work" explanation
now show only to admins. Members see the version, status, Check for updates, Update now, and Reset app cache.

## 3. Why members did not see the banner, and the fix
The banner has no role check, so it was not about who they are. A banner can only appear on a build that contains
the banner code, and only when something newer than their build exists.
**My earlier statement was wrong:** I said members on the old build would update themselves once. They would not.
The old build only switches versions when a new one activates immediately, and release 1.5.0 deliberately waits for
a tap. So members on 1.4.x stay on 1.4.x until they fully close the app, and never see a banner.

Fix: a temporary "bridge". `vite.config.js` has `BRIDGE_RELEASE = true` (new version activates immediately, which
old builds know how to handle by reloading). Members already on 1.5.x just see a "Nitalink was just updated, Reload now"
banner. The page is never reloaded unasked.

### Release plan
1. Deploy 1.5.1 with `BRIDGE_RELEASE = true`.
2. Keep it true for the next release too (1.5.2), so members who were away still get bridged.
3. From 1.5.3 set it to `false`. Everyone now gets the normal "Update now" banner.
Do not leave it true permanently. Reports loads jspdf and xlsx on demand, and swapping files under a tab that was
never reloaded can break exports.

## Also fixed (found while testing the bridge)
A brand-new visitor is "claimed" by the service worker, which fires a takeover event. That would have shown a
false "Nitalink was just updated" banner on first visits. It is now ignored. Three new tests cover it.

## Verified / not verified
16 simulated scenarios pass (`node tests/updateController.test.mjs`), static checks pass.
Not verified: a real browser and real deployment. Members who do not open the app during the bridge releases
will still need to close and reopen it fully once.

## Apply
Copy the files, or apply `patches/*.diff` from the project root (`patch -p1 < patches/<file>.diff`).

## Install App prompt (no change needed)
The "Install Nitalink App" banner appears only when Chrome reports the app as installable and not yet installed
in that browser profile. Installs are tracked per Chrome profile and per site address, so a second profile, or the
localhost dev server, is offered the install even if the production app is installed elsewhere. Kept as is.
