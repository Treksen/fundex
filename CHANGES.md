# Update banner fix

## The problem
The banner appeared and then vanished before it could be used.

## What I found
I could not reproduce this without a deployed build, so I removed the most likely cause instead of guessing.
The update library used before reloads the page automatically the moment ANY new version takes control, even if
the member never tapped "Update now". That happens when another tab, window or the installed app applies the
update, or when you redeploy while testing. The reload looks exactly like the banner disappearing.

## What changed
- The update logic is now our own small module, `src/lib/updateController.js`, instead of the library helper.
- **The page is never reloaded unless the member taps "Update now" / "Reload now".**
- If a new version takes over in another tab, this tab keeps working and shows
  "Nitalink was just updated. Reload to start using the new version" with a **Reload now** button.
- Settings -> App & Updates now has **Technical details**: offline support on/off, whether an update is waiting,
  and the last 10 update events with times. They survive a reload, so we can see what happened if it recurs.

## Verified
13 simulated scenarios pass (`node tests/updateController.test.mjs`), including: update already waiting at load,
update found while open, first-ever install shows no banner, banner survives tab switches and re-checks,
another tab activating an update does NOT reload this page, Update now only reloads after the switch,
Later hides it and a newer version brings it back, manual check found / not found / offline.
NOT verified: a real browser with a real deployment (service workers cannot run here).

## Apply
New: `src/lib/updateController.js`. Replace: `src/hooks/useAppUpdate.jsx`, `src/components/UpdateBanner.jsx`,
`src/pages/SettingsPage.jsx` (or apply `patches/*.diff`). No config change needed.
Bump `version` in package.json for the release, build, deploy.

## If it still disappears
Open Settings -> App & Updates -> Technical details right after, and send me a screenshot.
Also tell me: was the app open in more than one tab or window, or as the installed app at the same time?
