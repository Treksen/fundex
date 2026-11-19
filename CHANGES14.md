# Error Log covers the whole app + transparent logo

App version NOT changed. Bump it as usual so installed apps pick up the update. No database changes.

## 1. Error Log now catches problems everywhere
Before, only screen crashes and the Audit and Reports pages wrote to the Error Log. Now three things are captured
automatically, with no changes needed in the individual pages:

| What | Logged as | Example context in the log |
|---|---|---|
| Any failed database read/insert/update/delete or RPC | error (duplicates / constraint checks: warning) | `/transactions › rpc verify_deposit` |
| Server failures of edge functions, sign-in service, file uploads | error | `/members › function admin-manage-member` |
| Any error message shown to a user | merged into the failed request it came from (`shown_to_user` in Details) | |
| ...a shown error with no failed request behind it, if it reads like a failure ("Failed…", "Could not…") | warning | `/settings › message shown` |
| Uncaught JavaScript errors and unhandled promise rejections | error ("module failed to load" right after an update: warning) | `/goals › uncaught error` |
| admin-create-member and admin-manage-member failures (server side) | error, source "Edge function" | `admin-manage-member` |

Deliberately NOT logged (they are not bugs, and the user already sees why):
- wrong password, expired reset link, sign-in rate limits;
- the member tools refusing an action (wrong admin password, "demote first", etc.);
- input checks such as "Passwords do not match" or "Name cannot be empty";
- "no rows found" lookups, an expired session token that refreshes by itself, and anything while the device is offline;
- browser-extension errors and harmless browser noise (ResizeObserver, cross-origin "Script error.").

Privacy and safety:
- Request bodies are never recorded (they can contain passwords), nor query strings (filters can contain emails/ids).
  Only the table/function name, page, status, error code and the database's error message are kept.
- The same error is recorded once per minute; at most 30 entries per 10 minutes from one device, so a broken
  screen cannot flood the log. Entries made while offline wait and are sent when the connection returns.
- If logging itself fails, the app carries on as if nothing happened.

Where to look: Admin > Error Log. Open "Show details" on an entry to see the page, endpoint, status, hint and the
message the user saw.

## 2. Transparent logo
- The app now shows the Nitalink mark without the cream tile behind it: sidebar, mobile top bar, install banner,
  sign-in, reset-password and "choose your own password" screens (new `src/components/BrandLogo.jsx`).
- In dark mode it automatically switches to the light version (`logo-mark-dark.svg`: green + white rings), because
  the navy ring is almost invisible on a dark background. The sign-in page always uses the normal colours (its
  background is always light).
- Browser-tab icons (`favicon.svg` and the 16/32/64 px PNGs) are transparent too. `favicon.svg` also switches to the
  light rings when the browser itself is in dark mode.
- **Kept on purpose:** the home-screen app icons (`icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) keep
  their background. iPhones fill transparent areas of a home-screen icon with black, and Android "maskable" icons
  need a full background, so transparent versions would look worse. Tell me if you want a different colour there.
- `logo.jpeg` files are unchanged (JPEG cannot be transparent, and the app doesn't display them). A transparent
  PNG already exists: `public/images/logo.png`.

## Files
New: `src/lib/errorCapture.js`, `src/components/BrandLogo.jsx`, `tests/errors/errorCapture.test.mjs`
Changed (diffs in `patches/035_errorlog_logo/`, against the version with CHANGES13 applied):
`src/lib/supabase.js`, `src/main.jsx`, `src/components/AppShell.jsx`, `src/pages/LoginPage.jsx`,
`src/pages/ResetPasswordPage.jsx`, `src/pages/ChangePasswordRequiredPage.jsx`, `src/styles/main.css`,
`supabase/functions/admin-create-member/index.ts`, `supabase/functions/admin-manage-member/index.ts`
Images: `public/favicon.svg`, `public/favicon*.png`, `public/icons/favicon-*.png`

## ROLLOUT
1. `supabase functions deploy admin-manage-member` and `supabase functions deploy admin-create-member`
2. Deploy the website (bump the version).
Browsers cache tab icons hard: the new tab icon may take a while (or a hard refresh) to show.

## Verified here
- 17 new tests (`node tests/errors/errorCapture.test.mjs`): what is and isn't logged, no request bodies or query
  strings recorded, the response the app receives is untouched, merging the shown message into its failed request
  in either order, duplicates, rate limit, offline queue, extension noise, toast still shown.
- On the local PostgreSQL copy of your database: `log_error` works signed out (login page), signed in, and the
  functions' direct insert works with the service role.
- All other tests still pass (16 + 16 + 42 + 9 security, 16 navigation, 29 reports, 16 update scenarios).
- Syntax, imports and undefined-name checks across `src/`. Logo checked as images on light and dark backgrounds.

## NOT verified
- Not built or seen in a browser (packages can't be installed here). Please glance at the sidebar logo in light and
  dark mode, and at the sign-in page.
- That the Supabase client routes every request through the capture (it is the client's documented `global.fetch`
  option, so it should). A 1-minute check after deploying, signed in as admin:
  1. Open the browser's developer console on any page and run:
     `setTimeout(() => { throw new Error('Nitalink error log test') })`
  2. Wait a few seconds, then open Admin > Error Log: an entry "Nitalink error log test" (uncaught error) should be
     there. Mark it resolved or delete it.
  Failed requests will then show up on their own as they happen in normal use.
