# Nitalink v1.5.0 — in-app updates

## What members get
- **Banner** at the top of every page when a new version is ready: "A new version of Nitalink is available"
  with **Update now** and **Later** buttons. "Later" hides it until the next new version is found.
- **Settings → App & Updates** tab: current version, build date, installed-app vs browser, status
  ("latest version" / "update ready"), **Check for updates**, **Update now**, and a **Reset app cache** fix for stuck installs.
  A badge appears on the tab when an update is waiting. `/settings?tab=updates` opens it directly.
- The app checks for a new version every 30 minutes and whenever the member returns to it.

## Important behaviour change
Before: `registerType: 'autoUpdate'` + `skipWaiting` + `clientsClaim`, so the app updated itself silently and could reload mid-form.
Now: `registerType: 'prompt'`. The new version waits until the member taps **Update now**.
Members still on the old build get updated automatically once, on the first visit after you deploy this release.
After that, every update goes through the banner.

## Files
New: `src/hooks/useAppUpdate.jsx`, `src/components/UpdateBanner.jsx`
Changed: `vite.config.js`, `package.json` (1.4.0 -> 1.5.0), `src/App.jsx`, `src/components/AppShell.jsx`, `src/pages/SettingsPage.jsx`
If you have edited any changed file since v6, apply `patches/*.diff` instead of copying whole files:
`patch -p1 < patches/src_pages_SettingsPage.jsx.diff` (run from the project root).

## Releasing a new version (every time)
1. Bump `"version"` in `package.json` (e.g. 1.5.0 -> 1.5.1). The build date updates by itself.
2. `npm run build`, deploy.
3. Open members' apps pick it up within 30 minutes or on their next visit.

## How to test (needs a real deployment; service workers do not run in `npm run dev`)
1. Deploy 1.5.0 and open the app once.
2. Bump to 1.5.1 and deploy again.
3. In the still-open app: Settings -> App & Updates -> **Check for updates**. The banner and tab badge appear.
4. Tap **Update now**. The app reloads and Settings shows v1.5.1.

## Limits
- iPhone/iPad installed apps may only notice an update after being closed fully and reopened.
- Nothing here changes data or sign-in. Reset app cache clears cached app files only.
