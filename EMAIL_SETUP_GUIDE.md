# Fundex Email Notifications — Setup Guide

## What Was Built

Every in-app notification now **also sends a branded HTML email** to the
member's registered email address. Members control their preferences from
**Settings → Notifications**.

---

## Architecture

```
DB event (deposit / withdrawal / governance / investment)
  │
  ▼
notifications table  INSERT  (existing triggers unchanged)
  │
  ▼
Supabase Database Webhook  (new — you configure this once)
  │
  ▼
Edge Function: send-email-notification  (new Deno function)
  │
  ├─ Checks: member opted in? type suppressed?
  ├─ Builds branded HTML + plain-text email
  ├─ Calls Resend API  →  email delivered to member's inbox
  └─ Updates notifications.email_sent = true
```

No changes to any existing triggers or RPC functions.
The webhook fires **after** the notification row is inserted,
so the in-app notification always works even if email fails.

---

## Step-by-Step Setup

### 1. Run the SQL migration

Paste `015_email_notifications.sql` into **Supabase → SQL Editor** and run it.

This adds:
- `notifications.email_sent` + `email_sent_at` columns
- `profiles.email_notifications_enabled` and per-type toggles
- `email_notification_log` table
- `email_settings` table
- `member_email_stats` view

---

### 2. Get a free Resend API key

1. Go to **https://resend.com** and sign up (free tier = 3,000 emails/month)
2. In Resend dashboard → **API Keys** → **Create API Key**
3. Copy the key (starts with `re_`)
4. Optional but recommended: **Add & verify your domain** in Resend → Domains
   - If you skip this, use `onboarding@resend.dev` as FROM_EMAIL for testing

---

### 3. Deploy the Edge Function

**Option A — Supabase CLI (recommended)**
```bash
# Install CLI if needed
npm install -g supabase

# Link to your project
supabase login
supabase link --project-ref vhjhgodlltvurmzeynpt

# Deploy
supabase functions deploy send-email-notification
```

**Option B — Supabase Dashboard**
1. Go to **Edge Functions** in your Supabase dashboard
2. Click **New Function** → name it `send-email-notification`
3. Paste the contents of `supabase/functions/send-email-notification/index.ts`
4. Deploy

---

### 4. Set Edge Function Secrets

In **Supabase Dashboard → Edge Functions → send-email-notification → Secrets**,
add these environment variables:

| Secret | Value |
|--------|-------|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxxxxxxxxxx` |
| `FROM_EMAIL` | `Fundex Savings <notifications@yourdomain.com>` |
| `APP_URL` | `https://your-fundex-url.vercel.app` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **automatically injected**
by Supabase — you do NOT need to set these manually.

---

### 5. Create the Database Webhook

1. Go to **Supabase Dashboard → Database → Webhooks**
2. Click **Create a new hook**
3. Fill in:

| Field | Value |
|-------|-------|
| **Name** | `email-on-notification` |
| **Table** | `notifications` |
| **Events** | ✅ Insert |
| **Type** | Supabase Edge Functions |
| **Edge Function** | `send-email-notification` |

4. Click **Create webhook**

That's it. Every notification insert now triggers the email function.

---

### 6. Update the frontend files

Replace these files in your project:
- `src/pages/SettingsPage.jsx` — email preferences UI

---

## What Emails Look Like

- **Branded header** with Fundex logo and navy background
- **Colour-coded accent bar** (green = success, red = error, amber = warning, blue = approval)
- **Type badge** (e.g. "✅ Good news", "🗳️ Your vote")
- **Clear CTA button** → opens the relevant page in the app
- **Plain-text fallback** for email clients that don't render HTML
- **Unsubscribe link** in footer → goes to Settings → Notifications

---

## Email Types & Suppression

By default, `info` type notifications are **not emailed** (too noisy).
These get an in-app notification only. Everything else is emailed:

| Type | In-app | Email |
|------|--------|-------|
| `success` | ✅ | ✅ |
| `error` | ✅ | ✅ |
| `warning` | ✅ | ✅ |
| `approval` | ✅ | ✅ |
| `info` | ✅ | ❌ (suppressed) |

Admins can change `suppress_types` in the `email_settings` table.

---

## Member Preferences (Settings → Notifications)

Each member can:
- **Turn all email notifications ON/OFF** (master toggle)
- **Fine-tune by category:**
  - 💰 Deposits & contributions
  - 💸 Withdrawal approvals
  - 📈 Investment updates
  - 🗳️ Governance votes

Preferences are saved to `profiles` columns added in migration 015.

---

## Monitoring

Check the **`email_notification_log`** table in Supabase for a full audit trail:
```sql
SELECT * FROM email_notification_log ORDER BY sent_at DESC LIMIT 20;
```

Check per-member stats:
```sql
SELECT * FROM member_email_stats;
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Emails not sending | Check Edge Function logs in Supabase Dashboard |
| "API key invalid" | Verify `RESEND_API_KEY` secret is set correctly |
| "Domain not verified" | Use `onboarding@resend.dev` for testing, or verify domain |
| Member not receiving | Check `profiles.email_notifications_enabled = true` |
| Webhook not firing | Verify webhook is set to `INSERT` on `notifications` table |
