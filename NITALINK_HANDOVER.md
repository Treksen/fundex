# Nitalink — handover for a new chat (as of 19 Nov 2026)

Nitalink (formerly Fundex) is a group savings and investment web app: Vite + React PWA on Supabase
(Postgres, Auth, Edge Functions, Resend email). Paste this note into the new chat and attach a zip of the
current project folder WITHOUT `node_modules` and WITHOUT `.env.local`.

## Current state
- App version 1.5.3 in fundexV2 (owner bumps it per release). Do not change the version unless asked.
  `BRIDGE_RELEASE` is already false.
- Bundles applied in this order on top of fundexv6: fundex_v6_fixes, nitalink_branding, nitalink_email_text,
  nitalink_updates, nitalink_updates_fix, nitalink_members_fix, nitalink_reports, nitalink_security, nitalink_admin_nav,
  nitalink_member_tools (CHANGES13.md).
- Migrations added: 023-030 (deposit verification, back-fill, notifications, reject, 90-day bank-code window),
  031 correct bank code (not in the fundexV2 folder; run on Supabase), 032 error logs, 033 protect profiles
  (security fix, confirmed run and passing), 034 member admin tools (deactivate/suspend/temp password; see CHANGES13).
- Edge functions: send-email-notification (index.ts is live; index2.ts is NOT deployed, see below),
  send-scheduled-reminders (needs a daily Supabase cron), admin-create-member (admins add members server-side),
  admin-manage-member (edit/role/reset/temp password/suspend/deactivate, re-checks the admin's password).
- Tests (from project root): `node tests/errors/errorCapture.test.mjs`, `node tests/mpesa/run.mjs`, `node tests/mpesa/ui.test.mjs`, `node tests/nav/nav.test.mjs`, `node tests/security/run.mjs`,
  `node tests/reports/run.mjs`, and `tests/updateController.test.mjs` (copy src/lib/updateController.js next to it as
  updateController.mjs). 188 checks, all passing on 19 Nov.
- SQL can be tested for real: a sandbox with PostgreSQL 16 can apply all migrations on a small Supabase shim
  (auth schema with users/sessions, roles anon/authenticated/service_role, auth.uid() from request.jwt.claim.sub),
  then run 033_verify.sql and 034_verify.sql. Supabase's SQL editor does not keep temp tables or BEGIN/ROLLBACK
  state between statements: verify scripts must be ONE DO block that ends by raising an exception to undo itself. Skip files with "(" in the name, RESET_*, *verify*, *check_for_abuse*.

## Must confirm (security)
1. 033_check_for_abuse.sql was run and every admin/recent account is recognised.
2. DONE: 033_protect_profiles.sql run and passed; public sign-ups are OFF.
3. 034_member_admin_tools.sql then 034_verify.sql (expected final message: ALL CHECKS PASSED 16 of 16, or 15 of 15 + SKIP 16 with several admins) and admin-manage-member deployed.
4. Auth > URL configuration has the site URL and `<domain>/reset-password` as a redirect URL.
5. Custom SMTP set up (built-in Supabase email is for testing only), otherwise reset emails may not arrive.
6. Rotate the Supabase service-role key (it was inside the uploaded zip in `.env.local`).

## Known issues
- FIXED in 034 / CHANGES13: deleting members is replaced by deactivation; suspended/deactivated logins are blocked
  (Supabase ban + profile flags). Their server-side access token can stay valid up to ~1 hour; the app signs them out
  on the next profile check.
- index2.ts (not deployed) skips emails of type 'info' (back-fill, bank-code-corrected, others' verified/rejected).
- Error Log (CHANGES14): fed automatically by src/lib/errorCapture.js (failed Supabase requests via the client's
  global.fetch, toast.error messages merged into them, uncaught errors) plus ErrorBoundary and the admin functions.
  Home-screen app icons keep their background on purpose; in-app logo is transparent (BrandLogo.jsx, dark variant).
- `.gitignore` excludes `supabase/`, so migrations and edge functions are not in version control.
- Migration folder has duplicate 017/019 files with " (1)"/" (2)" in their names; the Supabase CLI won't push these.
- Both public/manifest.webmanifest and the vite-plugin-pwa manifest exist (minor).

## Member admin tools (built 19 Nov, CHANGES13; awaiting rollout)
- Admin Panel > Manage Members and a Manage button on Members cards. Edit details, change email/role, reset email,
  temporary password (shown once, forced change), suspend/restore sign-in, deactivate/reactivate.
- Admin re-enters own password for sensitive actions; audit-logged; member notified; admins protected (demote first).
- Deactivation deletes the member's PENDING votes on PENDING withdrawals and re-runs process_withdrawal_approval;
  withdrawals left with no voter are reported to the admin. Members are never deleted.
- Role/email/account fields can no longer be changed from the browser by anyone (server function only).
- Possible follow-ups: force a password change for brand-new members created with an admin-chosen password;
  show deactivated members separately in reports.
- Will NOT build: any way to view members' current passwords.

## Waiting on the owner
- Monthly report email: send day/time, summary+link vs PDF attachment, can members opt out.
- Reports: export one real PDF and Excel so the layout can be tuned (layout never seen rendered).
- M-Pesa STK push BUILT (CHANGES15, migration 035, functions mpesa-stk-push + mpesa-callback --no-verify-jwt,
  button hidden unless VITE_MPESA_ENABLED=true). Owner decisions: admin still verifies M-Pesa deposits; members pay
  for themselves, admins for anyone; profile phone pre-filled and editable; no extra limits. Owner has a Buni sandbox
  app "Nitalink" subscribed to MpesaExpressAPIService (+ optionally InstantPaymentNotification). Open questions for
  the sandbox test: invoiceNumber 12-char limit (swagger) vs 30 (PDF); token URL (PDF uat.../token vs portal
  accounts.buni.kcbgroup.com/oauth2/token); callbackUrl 50-char limit (short form https://finance.geotreks.co.ke/m/<16>);
  PDF says paybill 522533. Next possible step: KCB Instant Payment Notification for payments made from the M-Pesa menu.
- Trademark/name check for "Nitalink" in Kenya before investing in branding.
