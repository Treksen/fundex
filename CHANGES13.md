# Member admin tools: deactivate instead of delete, suspend sign-in, password help, roles

App version NOT changed. Bump it as you normally do for a release, so installed apps pick up the update.

## What was wrong
- **Delete member** failed for anyone with history (transactions, notifications and approvals point at the profile with
  no delete rule). Even when it worked, the person's login kept working.
- A member who left could block withdrawals forever: a withdrawal only completes when EVERY approver has approved, and
  their vote never came.

## What admins get now
Admin Panel has a new **Manage Members** card at the top (search, filters: All, Active, Suspended, Deactivated).
The **Manage** button on each card on the Members page opens the same tools. Delete and the inline edit are gone from there.

| Tool | Needs your own password | Notes |
|---|---|---|
| Edit name / phone | No | |
| Change sign-in email | Yes | Changes the login itself, not just the profile. Duplicate emails refused. |
| Change role | Yes | The last admin can never be removed (enforced by the database). |
| Send reset email | Yes | Uses the "Forgot password" email. Their old password keeps working until they use the link. |
| Set temporary password | Yes | Shown ONCE, never stored. The member must choose their own at next sign-in. |
| Suspend / restore sign-in | Yes | For a lost phone etc. They stay a member: votes, balances and notifications unchanged. |
| Deactivate / reactivate | Yes | For someone who left. Login blocked, history and balance kept, no more group notifications. Their pending withdrawal votes are removed and those withdrawals re-checked at once. |

Rules (enforced on the server, not just hidden in the screen):
- You cannot use these tools on your own account (use Profile / Security).
- You cannot reset, suspend, deactivate or change the email of **another admin**: make them a member first.
- Every action is in the Audit Log, and the member gets a notification (and email) about it.
- There is no way to see anyone's current password, by design.

After a deactivation, the dialog shows what happened to pending withdrawals. If a withdrawal has nobody left to vote
(e.g. the person who left was the only approver), it is listed with a link so an admin can approve or reject it.

## What members see
- After a temporary password, a **"Choose your own password"** screen before anything else. It goes away only when the
  password really changes (the database checks this, the browser cannot skip it).
- A suspended or deactivated member cannot sign in ("This account cannot sign in. If you think this is a mistake,
  contact a group admin."). Anyone already signed in is signed out the next time the app opens or comes to the foreground.

## Files
New:
- `supabase/migrations/034_member_admin_tools.sql`, `supabase/migrations/034_verify.sql`
- `supabase/functions/admin-manage-member/` (`index.ts`, `logic.ts`)
- `src/components/admin/MemberManager.jsx`, `src/components/admin/MemberActionsModal.jsx`
- `src/pages/ChangePasswordRequiredPage.jsx`, `src/lib/memberAdmin.js`
- `tests/security/manage-member.test.mjs`, `tests/security/member-admin-ui.test.mjs`

Changed (diffs in `patches/034_member_tools/`, apply with `git apply` or `patch -p1 <`):
`src/App.jsx`, `src/hooks/useAuth.jsx`, `src/pages/LoginPage.jsx`, `src/pages/MembersPage.jsx`,
`src/pages/SettingsPage.jsx` (adds the card; broadcast skips deactivated members),
`src/components/transactions/AddTransactionModal.jsx` (deactivated members are not asked to approve; marked "(deactivated)"
in the member list), `supabase/functions/send-scheduled-reminders/index.ts` (no reminders to deactivated members),
`tests/security/run.mjs` (runs the new tests; works without esbuild on Node 22.13+).
If you have edited any of these yourself since fundexV2, apply the diffs instead of copying whole files.

## ROLLOUT, in this order
1. Supabase SQL editor: run `034_member_admin_tools.sql`.
   If it stops at the `auth.users` trigger with a permission error, tell me (Supabase has been tightening the auth schema).
2. Run `034_verify.sql`. It changes nothing (ends in ROLLBACK, so no test emails go out). You want **PASS 1 to PASS 16**
   (PASS 16 prints SKIP if you have more than one admin). Needs one admin and two active members.
   Any "TEST FAILED" or error: stop and tell me.
3. Deploy the function: `supabase functions deploy admin-manage-member`
   and the changed reminder function: `supabase functions deploy send-scheduled-reminders`
4. Deploy the website (bump the version).
5. Check that Authentication > URL Configuration lists `https://<your-domain>/reset-password` as a redirect URL
   (rollout step 7 of the security bundle). "Send reset email" relies on it.

Order notes: the old app keeps working after step 1, except that old "Delete" and role edits on the Members page now
do nothing / show "Roles are changed from Admin Panel > Manage members". Installed apps on old versions get the new
screens with the update. If the website goes out before step 1, Manage Members says the database update is missing
and nothing else breaks.

## Database changes in 034 (for reference)
- `profiles`: `is_active`, `login_disabled`, `must_change_password`, `deactivated_at`, `deactivated_by`, `deactivation_reason`.
  Constraints: an admin is always active; an inactive member can never sign in.
- Role, email and these account fields can no longer be changed from the browser by anyone (only by the server function,
  which checks the admin's password). Members still edit their own name/phone/photo; admins still edit others' name/phone.
- The last-admin guard now also applies to the server and the SQL editor.
- Profiles can no longer be deleted from the browser.
- New withdrawal votes and notifications for deactivated members are skipped by the database (protects older app versions).
- Server-only functions: `admin_deactivate_member`, `admin_reactivate_member`, `admin_set_login_disabled`, `admin_member_summary`.

## Verified here
- **The SQL was run on a real PostgreSQL 16** with a Supabase-like setup (auth schema, roles, `auth.uid()`): all 34
  migrations from scratch, then `033_verify` (PASS 1-6, still passing) and `034_verify` (PASS 1-16), plus 6 extra
  edge cases: password change while the member's own claims are present, a withdrawal whose only voter leaves,
  an inactive member cannot be made admin, suspend/restore, the server role can call the new functions but anon cannot,
  role swaps between admins.
- 42 server-function tests (who may call, password re-entry, admin protection, order of steps and undo on failure,
  temp password never logged/stored, safe reset redirect, email change rollback). Two of these are regression tests for
  a bug found while testing: "reactivate" on an already-active member could have left them unable to sign in.
- 9 screen tests, including one that checks the buttons offered for each kind of member match exactly what the
  server allows.
- All existing tests still pass: 16 password-reset, 16 add-member, 16 navigation, 29 reports, 16 update scenarios.
- Syntax, imports and undefined-name checks across `src/`; `logic.ts` type-checks in strict mode.

## NOT verified
- Not built or seen in a browser (packages could not be installed here). Spacing of the new dialog and list unchecked.
- Not run against your real Supabase: real Auth bans, real reset emails, the real `auth.users` trigger.
  Step 2 checks the database side on your real data.
- A suspended/deactivated person's already-issued session token stays valid on the server for up to an hour
  (Supabase's token lifetime). The app signs them out as soon as it next checks, and they cannot renew the session.
