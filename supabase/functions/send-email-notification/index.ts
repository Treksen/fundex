// ============================================================
// Supabase Edge Function: send-email-notification
// Triggered by Supabase Database Webhook on notifications INSERT
// Sends a branded HTML email via Resend API
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'Fundex Savings <notifications@fundex.app>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://fundex.app'

// Notification types that should NOT send emails (too noisy)
const EMAIL_SUPPRESSED_TYPES = new Set(['info'])

// Colour map matching in-app badge colours
const TYPE_COLOR: Record<string, { accent: string; emoji: string; label: string }> = {
    success: { accent: '#0d9c5e', emoji: '✅', label: 'Good news' },
    error: { accent: '#dc3545', emoji: '❌', label: 'Action needed' },
    warning: { accent: '#e6900a', emoji: '⚠️', label: 'Heads up' },
    approval: { accent: '#3a4db5', emoji: '🗳️', label: 'Your vote' },
    info: { accent: '#3a4db5', emoji: 'ℹ️', label: 'Update' },
}

function buildHtml(opts: {
    memberName: string
    title: string
    message: string
    type: string
    actionUrl: string | null
    unsubToken: string
}): string {
    const cfg = TYPE_COLOR[opts.type] ?? TYPE_COLOR.info
    const actionLink = opts.actionUrl ? `${APP_URL}${opts.actionUrl}` : APP_URL
    const year = new Date().getFullYear()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:#0f1654;border-radius:14px 14px 0 0;padding:28px 32px;text-align:center;">
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td style="padding-right:12px;vertical-align:middle;">
                  <div style="width:42px;height:42px;border-radius:10px;background:#5a8a1e;display:inline-block;line-height:42px;text-align:center;font-size:20px;">💰</div>
                </td>
                <td style="vertical-align:middle;">
                  <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Fundex Savings</div>
                  <div style="font-size:11px;color:#85b82a;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Savings & Investment</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ACCENT BAR -->
        <tr>
          <td style="height:4px;background:${cfg.accent};"></td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#ffffff;padding:36px 32px;">

            <!-- Type badge -->
            <div style="margin-bottom:20px;">
              <span style="display:inline-block;background:${cfg.accent}18;color:${cfg.accent};border:1px solid ${cfg.accent}33;border-radius:99px;padding:4px 14px;font-size:12px;font-weight:700;letter-spacing:0.3px;">
                ${cfg.emoji}&nbsp;&nbsp;${cfg.label}
              </span>
            </div>

            <!-- Greeting -->
            <p style="margin:0 0 8px;font-size:15px;color:#4a5a50;">Hi ${opts.memberName},</p>

            <!-- Title -->
            <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#1a2020;line-height:1.3;">${opts.title}</h1>

            <!-- Message -->
            <p style="margin:0 0 28px;font-size:15px;color:#4a5a50;line-height:1.65;">${opts.message}</p>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:${cfg.accent};">
                  <a href="${actionLink}"
                     style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                    View in Fundex →
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f5f7f5;border-radius:0 0 14px 14px;padding:20px 32px;border-top:1px solid #e8eae8;">
            <p style="margin:0 0 8px;font-size:12px;color:#8a9a90;text-align:center;line-height:1.6;">
              You received this because you are a member of <strong>Fundex Savings & Investment</strong>.
            </p>
            <p style="margin:0;font-size:11px;color:#aab8b0;text-align:center;">
              © ${year} Fundex Savings &nbsp;·&nbsp;
              <a href="${APP_URL}/settings?tab=notifications&unsub=${opts.unsubToken}"
                 style="color:#5a8a1e;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildText(opts: {
    memberName: string
    title: string
    message: string
    actionUrl: string | null
}): string {
    const actionLink = opts.actionUrl ? `${APP_URL}${opts.actionUrl}` : APP_URL
    return [
        `Hi ${opts.memberName},`,
        '',
        opts.title,
        '─'.repeat(opts.title.length),
        '',
        opts.message,
        '',
        `View in Fundex: ${actionLink}`,
        '',
        '─────────────────────────────────────',
        'Fundex Savings & Investment',
        'You received this because you are a group member.',
    ].join('\n')
}

Deno.serve(async (req) => {
    // Supabase webhook sends POST with the inserted row in req.body
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 })
    }

    let payload: Record<string, unknown>
    try {
        payload = await req.json()
    } catch {
        return new Response('Bad JSON', { status: 400 })
    }

    // Supabase webhook payload: { type: 'INSERT', table: 'notifications', record: {...} }
    const record = (payload.record ?? payload) as Record<string, unknown>

    const userId = record.user_id as string
    const title = record.title as string
    const message = record.message as string
    const type = (record.type as string) ?? 'info'
    const actionUrl = record.action_url as string | null

    if (!userId || !title || !message) {
        return new Response('Missing required fields', { status: 400 })
    }

    // Suppress noisy info notifications from going to email
    if (EMAIL_SUPPRESSED_TYPES.has(type)) {
        return new Response(JSON.stringify({ skipped: true, reason: 'type suppressed' }), {
            headers: { 'Content-Type': 'application/json' },
        })
    }

    // Fetch member email & name from profiles using service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('name, email, email_notifications_enabled')
        .eq('id', userId)
        .single()

    if (profileErr || !profile) {
        console.error('Profile fetch error:', profileErr)
        return new Response('Profile not found', { status: 404 })
    }

    // Respect user email preference (defaults true if column doesn't exist)
    if (profile.email_notifications_enabled === false) {
        return new Response(JSON.stringify({ skipped: true, reason: 'user opted out' }), {
            headers: { 'Content-Type': 'application/json' },
        })
    }

    if (!profile.email) {
        return new Response(JSON.stringify({ skipped: true, reason: 'no email on profile' }), {
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const firstName = (profile.name as string)?.split(' ')[0] ?? 'Member'
    // Simple unsubscribe token (base64 of user_id — good enough for small group app)
    const unsubToken = btoa(userId)

    const html = buildHtml({
        memberName: firstName,
        title,
        message,
        type,
        actionUrl,
        unsubToken,
    })

    const text = buildText({ memberName: firstName, title, message, actionUrl })

    // Send via Resend
    const resendPayload = {
        from: FROM_EMAIL,
        to: [profile.email as string],
        subject: title,
        html,
        text,
        tags: [
            { name: 'app', value: 'fundex' },
            { name: 'type', value: type },
        ],
    }

    let resendRes: Response
    try {
        resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(resendPayload),
        })
    } catch (err) {
        console.error('Resend fetch error:', err)
        return new Response('Email send failed', { status: 502 })
    }

    const resendBody = await resendRes.json()

    if (!resendRes.ok) {
        console.error('Resend API error:', resendBody)
        // Log the failure but don't hard-fail — the in-app notification already exists
        await supabase.from('audit_logs').insert({
            action: 'email_send_failed',
            table_name: 'notifications',
            new_values: { error: resendBody, user_id: userId, title },
        })
        return new Response(JSON.stringify({ error: resendBody }), {
            status: resendRes.status,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    // Mark notification as email_sent in DB (uses the column added in migration 015)
    await supabase
        .from('notifications')
        .update({ email_sent: true, email_sent_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('title', title)
        .is('email_sent', null)
        .order('created_at', { ascending: false })
        .limit(1)

    console.log(`✅ Email sent to ${profile.email} — ${title}`)

    return new Response(
        JSON.stringify({ success: true, id: resendBody.id, to: profile.email }),
        { headers: { 'Content-Type': 'application/json' } },
    )
})
