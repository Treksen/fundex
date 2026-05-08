import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  console.log("FUNCTION STARTED");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: any;
  let record: any;

  try {
    body = await req.json();
    console.log("BODY:", JSON.stringify(body));
    record = body.record;

    if (!record) {
      console.error("NO RECORD FOUND");

      return new Response(
        JSON.stringify({ error: "No record found" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (err) {
    console.error("INVALID REQUEST BODY:", err);

    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // -----------------------------
  // FETCH USER EMAIL
  // -----------------------------
  let profile: any;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("email, name")
      .eq("id", record.user_id)
      .single();

    if (error || !data?.email) {
      console.error("PROFILE FETCH ERROR:", error);

      await supabase.from("email_notification_log").insert([
        {
          user_id: record.user_id,
          email_address: null,
          subject: record.title,
          resend_id: null,
          status: "failed",
          error_message: "Recipient email not found",
          sent_at: new Date().toISOString(),
        },
      ]);

      return new Response(
        JSON.stringify({ error: "Recipient email not found" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    profile = data;

    const displayName = profile.name?.trim() || "User";

    console.log("RECIPIENT:", profile.email);

    // -----------------------------
    // SEND EMAIL (RESEND)
    // -----------------------------
    let resendData: any;
    let resendOk = false;

    try {
      const resendResponse = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: Deno.env.get("FROM_EMAIL"),
            to: profile.email,
            subject: record.title,
            html: `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #333; padding: 10px;">
  <p style="margin-bottom: 6px;">
    Dear ${displayName},
  </p>

  <div style="font-size: 14px; white-space: pre-line;">
    ${record.message}
  </div>

  <div style="margin-top: 20px;">
    <a href="https://finance.geotreks.co.ke/"
       style="background:#0d9c5e;color:white;padding:10px 14px;
              text-decoration:none;border-radius:6px;display:inline-block;">
      Sign in to Fundex
    </a>
  </div>

  <hr style="margin: 30px 0;" />

  <p style="font-size: 12px; color: #777;">
    Admin<br/>
    Fundex Savings & Investments System
  </p>
</body>
</html>
            `,
          }),
        }
      );

      resendData = await resendResponse.json();
      resendOk = resendResponse.ok;

      console.log("RESEND RESPONSE:", resendData);
    } catch (err) {
      console.error("RESEND EXCEPTION:", err);

      resendOk = false;
      resendData = { error: err.message };
    }

    // -----------------------------
    // LOG EMAIL ATTEMPT
    // -----------------------------
    try {
      const { error: logError } = await supabase
        .from("email_notification_log")
        .insert([
          {
            user_id: record.user_id,
            email_address: profile.email,
            subject: record.title,
            resend_id:
              resendData?.id ?? resendData?.data?.id ?? null,
            status: resendOk ? "sent" : "failed",
            error_message: resendOk
              ? null
              : JSON.stringify(resendData),
            sent_at: new Date().toISOString(),
          },
        ]);

      if (logError) {
        console.error("EMAIL LOG INSERT FAILED:", logError);
      } else {
        console.log("EMAIL LOG SAVED SUCCESSFULLY");
      }
    } catch (err) {
      console.error("EMAIL LOG EXCEPTION:", err);
    }

    // -----------------------------
    // UPDATE NOTIFICATION STATUS
    // -----------------------------
    try {
      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          email_sent: resendOk,
          email_sent_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      if (updateError) {
        console.error("NOTIFICATION UPDATE ERROR:", updateError);
      }
    } catch (err) {
      console.error("UPDATE EXCEPTION:", err);
    }

    // -----------------------------
    // FINAL RESPONSE
    // -----------------------------
    return new Response(
      JSON.stringify({
        success: resendOk,
        resend: resendData,
      }),
      {
        status: resendOk ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("PROFILE EXCEPTION:", err);

    return new Response(
      JSON.stringify({ error: "Profile fetch failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});