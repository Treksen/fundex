# Pay with M-Pesa from the app (KCB Buni M-Pesa Express / STK push)

App version NOT changed. The button stays HIDDEN until you turn it on (step 6), so this is safe to deploy now.

## What it does
1. A member taps **Pay with M-Pesa** (Dashboard or Transactions), enters the amount; the phone is pre-filled from
   their profile and can be changed. An admin can also choose which member the deposit is for.
2. Nitalink asks KCB to send the M-Pesa PIN prompt to that phone (paid to KCB's paybill, account 1351460749).
3. When the PIN is entered, KCB tells Nitalink the result. On success Nitalink creates the deposit itself, with the
   real M-Pesa code as its reference, status **awaiting verification** (as you decided: an admin still verifies).
   The verifiers get the usual notification; the member gets "M-Pesa payment received".
4. The member sees the outcome live: received (with the code), cancelled, wrong PIN, not enough balance, phone not
   reachable. In the transactions list the deposit is marked "✓ Paid in app (M-Pesa confirmed)".
Pasting a code by hand (Add Transaction / Transact) still works for payments made outside the app.

## Safety
- The KCB key and secret live only on the server (Supabase secrets), never in the website.
- KCB's confirmation is not signed, so each payment gets its own unguessable secret inside its confirmation address;
  only its fingerprint (hash) is stored. A confirmation without the right secret is kept for review but ignored.
- A payment is recorded once, even if KCB repeats the message; it must match the request's checkout ID and amount;
  one M-Pesa code can never create two deposits. Anything odd becomes "needs review" and the admins are notified.
- A second prompt for the same member within a minute is refused (double taps).
- Every message from KCB is stored as received (`mpesa_callbacks`) for reconciliation.

## Files
New: `supabase/migrations/035_mpesa_stk.sql`, `supabase/migrations/035_verify.sql`,
`supabase/functions/_shared/mpesa.ts`, `supabase/functions/mpesa-stk-push/` (`index.ts`, `logic.ts`),
`supabase/functions/mpesa-callback/` (`index.ts`, `logic.ts`), `src/components/transactions/MpesaPayModal.jsx`,
`src/lib/mpesa.js`, `tests/mpesa/` (`run.mjs`, `mpesa.test.mjs`, `ui.test.mjs`)
Changed: `src/pages/TransactionsPage.jsx`, `src/pages/DashboardPage.jsx` (button + "paid in app" marker),
`vercel.json` (short confirmation address `/m/<code>`), `vite.config.js` (installed app never intercepts `/m/`)

## SETUP, in this order
1. **Database.** SQL editor: run `035_mpesa_stk.sql`, then `035_verify.sql`.
   Expected final message: `ALL M-PESA CHECKS PASSED (12 of 12). Nothing was saved...`
2. **Secrets.** In a terminal in the project folder (replace the two values in < >, keep the quotes):
   ```
   supabase secrets set MPESA_ENABLED=true KCB_ACCOUNT_NUMBER=1351460749 MPESA_CALLBACK_BASE=https://finance.geotreks.co.ke/m
   supabase secrets set KCB_CONSUMER_KEY="<hV14nlD9PCzfgvr3rkgv6RmgsiMa>" KCB_CONSUMER_SECRET="<0rKTTygfsSY9APwkUdIHDEZ05ODLGMBpB0pSSN8HjDga>"
   ```
   (If your live site is not finance.geotreks.co.ke, use your domain + `/m`, and tell me: the total address must stay
   within KCB's 50-character limit.)
3. **Functions.**
   ```
   supabase functions deploy mpesa-stk-push
   supabase functions deploy mpesa-callback --no-verify-jwt
   ```
   `--no-verify-jwt` is required on the callback: KCB calls it without a Supabase sign-in (it is protected by the
   per-payment secret instead). The payment function keeps normal sign-in checks.
4. **Website.** Deploy as usual (the button is still hidden). This puts the `/m/` forwarding live on Vercel.
5. **Sandbox test, on your own computer only.** Add `VITE_MPESA_ENABLED=true` to your `.env.local`, run
   `npm run dev`, sign in, and pay **KES 1** to your own Safaricom number. Then tell me what you saw, or check:
   - Admin > Error Log (entries from `mpesa-stk-push` / `mpesa-callback`),
   - Supabase Table Editor > `mpesa_requests` (status, result_desc) and `mpesa_callbacks` (what KCB sent).
   Note: KCB's sandbox may send a REAL prompt and take REAL money. Always test with KES 1.
6. **Go live** (after KCB approves your go-live letter and gives production access):
   - generate PRODUCTION keys in the Buni portal, then:
     `supabase secrets set KCB_CONSUMER_KEY="<prod key>" KCB_CONSUMER_SECRET="<prod secret>" KCB_TOKEN_URL=<prod token URL> KCB_STK_URL=<prod stkpush URL>`
     (KCB gives the production addresses; send them to me if unsure),
   - add `VITE_MPESA_ENABLED=true` in Vercel > Project > Settings > Environment Variables and redeploy,
   - one live KES 1 payment, and check it lands in account 1351460749.

## Things the sandbox test will tell us (from KCB's documents)
- **Account reference length.** KCB's API file allows only 12 characters for `<account>-<reference>`, which leaves
  1 reference character after `1351460749-`. Matching does not depend on it. If KCB accepts more, set
  `MPESA_INVOICE_MAX=20` so your bank statement shows a longer payment reference.
- **Token address.** KCB's PDF uses `https://uat.buni.kcbgroup.com/token` (the default here). If the Error Log shows
  "KCB token request failed", run `supabase secrets set KCB_TOKEN_URL=https://accounts.buni.kcbgroup.com/oauth2/token`
  (the address your portal shows) and try again.
- **Paybill.** KCB's PDF mentions paybill 522533, not 522522. The money still goes to account 1351460749; it only
  changes the name/number members see. Ask KCB when you send the go-live letter.

## Verified here
- On the local PostgreSQL copy of your database: `035_verify.sql` 12 of 12 (browser can't read the secret or write
  payments; success creates a deposit awaiting verification; repeated confirmation ignored; wrong checkout ID refused;
  wrong amount and reused M-Pesa code go to review with admins notified; cancel; late success after a timeout;
  notifications; an admin verifies the app deposit with the existing verification), and nothing left behind.
- The REAL callback code run against the REAL database function with KCB's documented sample (twice): one deposit,
  correct code, amount and Kenyan time, second message recorded as "already_recorded".
- 22 server tests (built from KCB's swagger, Postman collection and PDF: exact request fields, 50-character callback
  address, phone formats, token renewal, KCB refusals, forged confirmations, unreadable messages, database outage)
  and 5 screen tests. Both functions type-check in strict mode. All earlier tests still pass.

## NOT verified
- No call to KCB has been made (that needs your keys and happens in step 5).
- Not built or seen in a browser here.
- There is no admin screen yet listing all app payments; "needs review" cases arrive as notifications and are visible
  in the Supabase table `mpesa_requests`. Easy to add if you want it.
