# Nitalink — email text

Visible brand text changed from "Fundex" to "Nitalink" in both versions of the email function:
- `index.ts` – "Sign in to Nitalink" button, footer line
- `index2.ts` – sender default, header, "View in Nitalink" button, footer sentence, copyright line, plain-text version

Not changed: the analytics tag `{ name: 'app', value: 'fundex' }` in `index2.ts`. Changing it would split your
email stats in Resend into two groups. Rename it only if you don't need continuity.

## You must also do these two things
1. **Redeploy the function:** `supabase functions deploy send-email-notification`
   (only the deployed copy sends emails, editing the file alone changes nothing).
2. **Check the `FROM_EMAIL` secret** in Supabase. `index.ts` takes the sender name only from that secret, and
   `index2.ts` uses it before its default. If it still says "Fundex ...", set it, for example:
   `supabase secrets set FROM_EMAIL="Nitalink <info@geotreks.co.ke>"`
