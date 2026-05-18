import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// Two responsibilities in this function:
//
// (1) MONTHLY scheduled reminders (existing behavior — preserved).
//     Fires the configured reminder_type on its day_of_month.
//
// (2) DAILY staleness nudges (new). Independent of (1) — runs
//     every time this function is invoked. Looks for:
//       (a) Deposits still in pending_verification more than
//           3 days after creation → nudges the eligible verifiers.
//       (b) Completed deposits with NULL bank_verification_code
//           older than 14 days → nudges eligible back-fillers
//           (admin or any member if depositor is admin).
//
//     Dedupe: each nudge writes a metadata.kind so we can find
//     the most recent nudge for that (tx, user, kind) and skip
//     if we already sent one in the last 24 hours.
//
// Invocation: expected to be called daily by a Supabase Cron
// schedule. Safe to run multiple times per day.
// ============================================================

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const today = new Date();
  const day = today.getDate();
  const todayISO = today.toISOString().split("T")[0];

  console.log("🔁 Running scheduled reminders job...");

  // (2) DAILY STALENESS NUDGES — always run
  let staleSent = 0;
  try {
    staleSent = await runStalenessNudges(supabase);
    console.log(`Staleness nudges sent: ${staleSent}`);
  } catch (e) {
    console.error("STALENESS NUDGE ERROR:", e);
  }

  // (1) MONTHLY SCHEDULED REMINDERS — original behavior
  const { data: reminders, error: remErr } = await supabase
    .from("scheduled_reminders")
    .select("*")
    .eq("is_active", true)
    .eq("day_of_month", day);

  if (remErr) {
    console.error("REMINDER FETCH ERROR:", remErr);
    return new Response(
      JSON.stringify({ staleSent, monthlyError: remErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!reminders || reminders.length === 0) {
    console.log("No monthly reminders due today.");
    return new Response(
      JSON.stringify({ staleSent, monthlyProcessed: 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const { data: users, error: userErr } = await supabase
    .from("profiles")
    .select("id, email, name");

  if (userErr) {
    console.error("USER FETCH ERROR:", userErr);
    return new Response("User fetch error", { status: 500 });
  }

  for (const reminder of reminders) {
    if (reminder.last_run_date === todayISO) {
      console.log("Already sent today, skipping:", reminder.id);
      continue;
    }

    for (const user of users || []) {
      try {
        const { error: notifErr } = await supabase
          .from("notifications")
          .insert({
            user_id: user.id,
            title: reminder.config?.title || reminder.reminder_type,
            message:
              reminder.config?.message ||
              "System scheduled reminder notification",
            type: "info",
            action_url: "https://finance.geotreks.co.ke/",
          });

        if (notifErr) {
          console.error("NOTIFICATION INSERT ERROR:", notifErr);
          continue;
        }
      } catch (err) {
        console.error("USER PROCESS ERROR:", err);
      }
    }

    await supabase
      .from("scheduled_reminders")
      .update({
        last_run_date: todayISO,
        last_sent: new Date().toISOString(),
      })
      .eq("id", reminder.id);
  }

  return new Response(
    JSON.stringify({
      success: true,
      monthlyProcessed: reminders.length,
      staleSent,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});


// ────────────────────────────────────────────────────────────
// Staleness nudge helper
// ────────────────────────────────────────────────────────────
async function runStalenessNudges(supabase: any): Promise<number> {
  const PENDING_VERIFICATION_DAYS = 3;
  const BACKFILL_DAYS = 14;
  const DEDUPE_HOURS = 24;

  const pvCutoff = new Date(
    Date.now() - PENDING_VERIFICATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const bfCutoff = new Date(
    Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const dedupeCutoff = new Date(
    Date.now() - DEDUPE_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, role");
  if (!profiles) return 0;

  let totalSent = 0;

  // (a) Stale pending_verification deposits
  const { data: pendingStale } = await supabase
    .from("transactions")
    .select(
      "id, user_id, amount, reference, transaction_date, profiles!transactions_user_id_fkey(name, role)"
    )
    .eq("type", "deposit")
    .eq("status", "pending_verification")
    .lte("transaction_date", pvCutoff);

  for (const tx of pendingStale || []) {
    const depositorRole = tx.profiles?.role;
    const depositorName = tx.profiles?.name || "A member";
    const ageDays = Math.floor(
      (Date.now() - new Date(tx.transaction_date).getTime()) /
        (24 * 60 * 60 * 1000)
    );

    const eligibleVerifiers = profiles.filter(
      (p: any) =>
        p.id !== tx.user_id &&
        (depositorRole === "admin" || p.role === "admin")
    );

    for (const v of eligibleVerifiers) {
      const sent = await sendNudge(supabase, {
        userId: v.id,
        kind: "stale_pending_verification",
        txId: tx.id,
        dedupeCutoff,
        title: "⏰ Deposit still awaiting verification",
        message:
          depositorName +
          "'s deposit of KES " +
          formatAmount(tx.amount) +
          " has been awaiting verification for " +
          ageDays +
          " days. Please confirm in the bank account and add the bank reference code.",
        actionUrl: "/transactions?pending=" + tx.id,
      });
      if (sent) totalSent++;
    }
  }

  // (b) Stale un-back-filled completed deposits
  const { data: backfillStale } = await supabase
    .from("transactions")
    .select(
      "id, user_id, amount, reference, transaction_date, profiles!transactions_user_id_fkey(name, role)"
    )
    .eq("type", "deposit")
    .eq("status", "completed")
    .is("bank_verification_code", null)
    .lte("transaction_date", bfCutoff);

  for (const tx of backfillStale || []) {
    const depositorRole = tx.profiles?.role;
    const depositorName = tx.profiles?.name || "A member";

    const eligibleBackfillers = profiles.filter(
      (p: any) =>
        p.id !== tx.user_id &&
        (depositorRole === "admin" || p.role === "admin")
    );

    for (const v of eligibleBackfillers) {
      const sent = await sendNudge(supabase, {
        userId: v.id,
        kind: "stale_pending_backfill",
        txId: tx.id,
        dedupeCutoff,
        title: "⏰ Old deposit still missing bank code",
        message:
          depositorName +
          "'s earlier deposit of KES " +
          formatAmount(tx.amount) +
          " still needs its bank verification code added. " +
          "Please add it from your bank statement.",
        actionUrl: "/transactions?pending=" + tx.id,
      });
      if (sent) totalSent++;
    }
  }

  return totalSent;
}

async function sendNudge(
  supabase: any,
  args: {
    userId: string;
    kind: string;
    txId: string;
    dedupeCutoff: string;
    title: string;
    message: string;
    actionUrl: string;
  }
): Promise<boolean> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .gte("created_at", args.dedupeCutoff)
    .filter("metadata->>kind", "eq", args.kind)
    .filter("metadata->>transaction_id", "eq", args.txId);

  if (count && count > 0) return false;

  const { error } = await supabase.from("notifications").insert({
    user_id: args.userId,
    title: args.title,
    message: args.message,
    type: "approval",
    action_url: args.actionUrl,
    metadata: {
      kind: args.kind,
      transaction_id: args.txId,
    },
  });
  return !error;
}

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
