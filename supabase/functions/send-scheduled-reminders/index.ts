import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const today = new Date();
  const day = today.getDate();
  const todayISO = today.toISOString().split("T")[0];

  console.log("🔁 Running scheduled reminders job...");

  // 1. Get active reminders due today
  const { data: reminders, error: remErr } = await supabase
    .from("scheduled_reminders")
    .select("*")
    .eq("is_active", true)
    .eq("day_of_month", day);

  if (remErr) {
    console.error("REMINDER FETCH ERROR:", remErr);
    return new Response("Error fetching reminders", { status: 500 });
  }

  if (!reminders || reminders.length === 0) {
    console.log("No reminders due today.");
    return new Response("No reminders", { status: 200 });
  }

  // 2. Get all users
  const { data: users, error: userErr } = await supabase
    .from("profiles")
    .select("id, email, name");

  if (userErr) {
    console.error("USER FETCH ERROR:", userErr);
    return new Response("User fetch error", { status: 500 });
  }

  for (const reminder of reminders) {
    console.log("Processing:", reminder.reminder_type);

    // prevent duplicate runs
    if (reminder.last_run_date === todayISO) {
      console.log("Already sent today, skipping:", reminder.id);
      continue;
    }

    for (const user of users || []) {
      try {
        // 3. Insert notification (this triggers your email system)
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

        console.log(`Sent to ${user.email}`);
      } catch (err) {
        console.error("USER PROCESS ERROR:", err);
      }
    }

    // 4. mark reminder as executed
    await supabase
      .from("scheduled_reminders")
      .update({
        last_run_date: todayISO,
        last_sent: new Date().toISOString(),
      })
      .eq("id", reminder.id);
  }

  return new Response(
    JSON.stringify({ success: true, processed: reminders.length }),
    { headers: { "Content-Type": "application/json" } }
  );
});