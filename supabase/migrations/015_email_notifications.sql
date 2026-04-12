-- ============================================================
-- Migration 015: Email Notification Infrastructure
-- Adds email tracking columns and user preference control
-- Run after 001-014
-- ============================================================

-- ── 1. Add email tracking columns to notifications ────────────
-- Lets us see which notifications were emailed, when, and
-- whether the user has opted out of email alerts.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_sent     BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_sent_at  TIMESTAMPTZ DEFAULT NULL;

-- ── 2. Add email notification preference to profiles ──────────
-- Each member can toggle emails on/off from their Settings page.
-- Defaults to TRUE (opted in).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_digest_enabled        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notify_on_deposits          BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_on_withdrawals       BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_on_investments       BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_on_governance        BOOLEAN DEFAULT TRUE;

-- ── 3. email_notification_log: audit trail of all sent emails ─
-- Useful for debugging and preventing duplicate sends.

CREATE TABLE IF NOT EXISTS email_notification_log (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  email_address TEXT NOT NULL,
  subject       TEXT NOT NULL,
  resend_id     TEXT,            -- ID returned by Resend API
  status        TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'failed', 'skipped', 'bounced')),
  error_message TEXT,
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view email logs"
  ON email_notification_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "System can insert email logs"
  ON email_notification_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── 4. email_settings table — global config (admin-managed) ───

CREATE TABLE IF NOT EXISTS email_settings (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  from_name         TEXT NOT NULL DEFAULT 'Fundex Savings',
  from_email        TEXT NOT NULL DEFAULT 'notifications@fundex.app',
  reply_to          TEXT,
  suppress_types    TEXT[] DEFAULT ARRAY['info'],   -- notification types to NOT email
  min_interval_mins INT DEFAULT 5,                  -- throttle: min mins between emails to same user
  is_enabled        BOOLEAN DEFAULT TRUE,
  updated_by        UUID REFERENCES profiles(id),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view email settings"
  ON email_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can manage email settings"
  ON email_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed default settings
INSERT INTO email_settings (from_name, from_email, suppress_types)
VALUES ('Fundex Savings', 'notifications@fundex.app', ARRAY['info'])
ON CONFLICT DO NOTHING;

-- ── 5. View: email sending stats per member ───────────────────

CREATE OR REPLACE VIEW member_email_stats AS
SELECT
  p.id,
  p.name,
  p.email,
  p.email_notifications_enabled,
  COUNT(enl.id)                                    AS total_emails_sent,
  COUNT(enl.id) FILTER (WHERE enl.status = 'failed')  AS failed_count,
  COUNT(enl.id) FILTER (WHERE enl.status = 'skipped') AS skipped_count,
  MAX(enl.sent_at)                                 AS last_email_sent_at
FROM profiles p
LEFT JOIN email_notification_log enl ON enl.user_id = p.id
GROUP BY p.id, p.name, p.email, p.email_notifications_enabled;

-- ── 6. RLS: allow members to see/update their own email prefs ─

-- Members can already UPDATE their own profile via existing policy.
-- The new email_* columns are included automatically.

-- ── 7. Helpful index for email log queries ────────────────────

CREATE INDEX IF NOT EXISTS idx_email_log_user_sent
  ON email_notification_log (user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_email_sent
  ON notifications (user_id, email_sent, created_at DESC);

-- ============================================================
-- HOW THE EMAIL SYSTEM WORKS
-- ============================================================
--
--  FLOW:
--   1. Any event (deposit, withdrawal approval, governance vote,
--      investment update, etc.) inserts a row into 'notifications'
--      via the existing DB triggers or RPC functions.
--
--   2. Supabase detects the INSERT via a Database Webhook
--      and calls the Edge Function:
--        POST https://<project>.supabase.co/functions/v1/send-email-notification
--
--   3. The Edge Function:
--        a. Reads the notification row (user_id, title, message, type)
--        b. Fetches the member's email from profiles
--        c. Checks email_notifications_enabled on the profile
--        d. Checks suppress_types in email_settings
--        e. Builds a branded HTML + plain-text email
--        f. Sends via Resend API (resend.com)
--        g. Updates notifications.email_sent = true
--        h. Inserts a row into email_notification_log
--
--  SETUP STEPS (after running this migration):
--   1. Go to resend.com → sign up free → create API key
--   2. Verify your sending domain (or use onboarding.resend.dev for testing)
--   3. In Supabase Dashboard:
--        Edge Functions → send-email-notification → Deploy
--        (or: supabase functions deploy send-email-notification)
--   4. Set Edge Function secrets:
--        RESEND_API_KEY     = re_xxxxxxxxxxxx
--        FROM_EMAIL         = Fundex Savings <notifications@yourdomain.com>
--        APP_URL            = https://your-fundex-url.vercel.app
--   5. Create Database Webhook:
--        Supabase Dashboard → Database → Webhooks → Create
--          Table:   notifications
--          Events:  INSERT
--          URL:     https://<project>.supabase.co/functions/v1/send-email-notification
--          Headers: Authorization: Bearer <SUPABASE_ANON_KEY>
--
-- ============================================================
