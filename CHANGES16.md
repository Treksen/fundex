# Transparent app icons, bigger mark (updated: rings larger, thicker and brighter)

No database or function changes. Bump the version and deploy as usual.

- `public/icons/icon-192.png`, `icon-512.png`: transparent background, the mark fills ~88% of the width
  (was a cream tile with a smaller mark). Used for the installed app on Windows/Mac, Android's app list and splash.
- NEW `public/icons/icon-maskable-192.png`, `icon-maskable-512.png`: Android home-screen icons. White background on
  purpose: Android cuts these into a circle/rounded square and would show black where it is transparent. The mark is
  as large as Android's safe zone allows (checked: nothing gets cut off).
- `public/icons/apple-touch-icon.png` and `public/apple-touch-icon.png`: white background on purpose: iPhones fill
  transparency with black. Mark enlarged.
- Rings now fill the icon edge to edge (98% width on transparent icons), slightly thicker, colours brightened:
  green #4A7018 -> #5C9420, blue #1B1F7A -> #2A30A0 (app icons only; the in-app logo and favicon are unchanged).
- `vite.config.js` (manifest) and `index.html`: point to the new icons with `?v=3`, so installed apps notice the change.

Already-installed apps may keep the old icon for a while (the phone/computer caches it). Chrome usually updates
within a day or two after the next visit; on iPhone, removing and re-adding to the home screen shows it immediately.
