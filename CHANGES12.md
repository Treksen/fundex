# Security fix + "Forgot password?"  (app version NOT changed; no package.json in this bundle)

## What was wrong (found by reading your migrations, confirmed against your live database)
1. Anyone on the internet could create an ADMIN account. `handle_new_user()` copied the role from sign-up metadata,
   which the browser controls, and the Supabase API key is public.
2. Any logged-in member could edit any profile, including making themselves admin. The live policy
   "Authenticated can update profiles" is `UPDATE, USING true, WITH CHECK true`.
3. The "Allow profile creation" INSERT policy was `WITH CHECK true`. The last admin could be demoted or deleted.
These affect every protection built on roles: verification, back-fill, approvals, reports, admin pages.

## What this bundle changes
- `033_protect_profiles.sql`: role is ALWAYS 'member' at sign-up. A trigger lets only admins change roles/emails or edit
  other members' rows (members still edit their own profile; the equity recalculation that touches other members' cached
  equity_status/loan_balance keeps working). INSERT policy tightened. The last admin cannot be demoted or deleted.
- `admin-create-member` server function: admins create members server-side (service role). The admin is no longer
  switched into the new member's session, the email is auto-confirmed, the role is set by the server, the password is never
  logged or returned, and a half-created account is cleaned up if a step fails. Settings -> Add member now calls it.
- "Forgot password?" on the login page, and a `/reset-password` page (sets the new password, then signs out so it must be used).
  The reply is identical whether or not an email has an account.

## ROLLOUT: do these IN THIS ORDER
1. Supabase SQL editor: run `033_check_for_abuse.sql` (read-only). Do you recognise every admin and every recent account?
   If not, remove them and tell me. Rotate passwords of any admin you doubt.
2. Deploy the function:  `supabase functions deploy admin-create-member`
3. Deploy the website (the files in `src/`, or apply `patches/*.diff`).
4. Run `033_protect_profiles.sql`, then `033_verify.sql` (changes nothing, ends in ROLLBACK). You want PASS 1 to PASS 5
   (PASS 6 needs exactly one admin, else it prints SKIP). Any "TEST FAILED": stop and tell me.
5. Optional attack check, BEFORE step 6 (signups still on). This must now create a plain MEMBER:
   curl -X POST "https://<project-ref>.supabase.co/auth/v1/signup" -H "apikey: <anon key>" -H "Content-Type: application/json" \
     -d '{"email":"role-test@example.com","password":"Test12345!","data":{"role":"admin"}}'
   then `select email, role from profiles where email='role-test@example.com';` shows 'member'. Delete that test user afterwards.
6. Supabase Dashboard -> Authentication -> sign-in settings: turn OFF "Allow new users to sign up". Do this only after
   steps 2 and 3, because the old browser sign-up path is gone and members are now created by the function.
7. Authentication -> URL Configuration: set Site URL to your live address and add Redirect URLs
   `https://<your-domain>/reset-password` and `http://localhost:5173/reset-password`.
8. Authentication -> SMTP Settings: configure Custom SMTP (Resend offers SMTP). Supabase's built-in email is for testing,
   is heavily rate-limited, and may not deliver to ordinary members. Optionally brand the "Reset Password" template.

## Verified here
- 32 automated checks (run `node tests/security/run.mjs` from the project root; uses esbuild, already installed with Vite):
  16 for the server function (who gets in, validation, cleanup on failure, password never echoed or logged, CORS) and
  16 for Forgot password (enumeration-safe reply, rate-limit message, update-then-sign-out order, expired/invalid links,
  late recovery event, timeouts, listener cleanup).
- Syntax, imports and undefined-name checks pass across the whole project; `RecoveryGate` confirmed to sit inside the auth provider.
- Patches apply cleanly to my reconstruction of your current files.

## NOT verified (be aware)
- The SQL has NOT been run on a real Postgres (none available here). That is why `033_verify.sql` exists. Run it.
- The server function has not been deployed against your real Supabase Auth.
- Nothing has been tried in a real browser or with a real reset email.
- My working copy was reset mid-task; I rebuilt your project from your original upload plus the bundles I gave you.
  If you edited LoginPage, App.jsx, useAuth.jsx or SettingsPage.jsx yourself since, apply the diffs, not the whole files.

## Still open (next step)
- Deleting a member removes only the profile row; their LOGIN still works. Admin tools to disable a login, reset a member's
  password (temporary password shown once, forced change), and change roles are the planned next step.
- Members can still edit their own cached equity_status/loan_balance display fields (real balances come from transactions).
