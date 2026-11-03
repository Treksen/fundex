# Nitalink branding — Joined rings logo

## New brand assets (public/)
- `logo-mark.svg` – the mark on light backgrounds · `logo-mark-dark.svg` – for dark backgrounds
- `logo-tile.svg` – mark on a rounded light tile (used in the app UI)
- `favicon.svg`, `favicon*.png`, `apple-touch-icon.png`, `icons/icon-192.png`, `icons/icon-512.png` – regenerated
  (full-bleed square, mark inside the maskable safe zone)

## App changes
- `AppShell.jsx` – sidebar, mobile top bar and install banner use the new tile; name is Nitalink
- `LoginPage.jsx` – logo shown above the heading again; heading is Nitalink
- `index.html`, `vite.config.js`, `public/manifest.webmanifest` – title, meta, PWA name, SVG favicon link
- `App.jsx`, `ReportsPage.jsx` – loading text, PDF/Excel report titles and file names

## Deliberately NOT changed
- `src/hooks/useTheme.js` – storage key `fundex-theme` (renaming would reset everyone's saved theme)
- `SettingsPage.jsx` placeholder `jane@fundex.app`; commented-out block in `LoginPage.jsx`
- `supabase/functions/send-email-notification/*` – emails still say "Fundex"; changing them needs a redeploy
- `public/logo.jpeg`, `public/images/logo.*` – old Geotreks image, now unused by the UI

## Apply
Copy the files over your project, run `npm run build`, redeploy. Installed PWAs and phones cache icons,
so the new home-screen icon appears after reinstalling or clearing the app.
