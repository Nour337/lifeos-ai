import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// GET /api/cron/notify — run every 5 minutes by a scheduler (Supabase
// pg_cron, Vercel Cron, or any uptime pinger) with
// "Authorization: Bearer <CRON_SECRET>". The database decides what is due
// (reminders, morning brief, evening check-in, deadlines, weekly review) and
// records it so nothing is sent twice; this route delivers it by web push.

type Due = {
  user_id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  subs: { endpoint: string; p256dh: string; auth: string }[] | null;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || given !== secret) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return Response.json({ error: "Push isn't set up (VAPID keys missing)." }, { status: 503 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || process.env.NEXT_PUBLIC_SITE_URL || "mailto:admin@localhost",
    publicKey,
    privateKey
  );

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("get_due_notifications", { p_secret: secret });
  if (error) {
    console.error("get_due_notifications failed:", error.message);
    return Response.json({ error: "Couldn't load notifications." }, { status: 500 });
  }

  const due = (data ?? []) as Due[];
  let sent = 0;
  const gone = new Set<string>();
  await Promise.all(
    due.flatMap((n) =>
      (n.subs ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.kind }),
            { TTL: 60 * 60 }
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.add(sub.endpoint);
          else console.error("Push failed:", status, (e as Error).message);
        }
      })
    )
  );

  // The browser unsubscribed or the subscription expired
  await Promise.all(
    [...gone].map((endpoint) => supabase.rpc("remove_push_subscription", { p_secret: secret, p_endpoint: endpoint }))
  );

  return Response.json({ due: due.length, sent, removed: gone.size });
}
