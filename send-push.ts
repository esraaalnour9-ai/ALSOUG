// دالة Supabase Edge Function باسم: send-push
// ترسل إشعارًا لكل المشتركين. للمدير العام فقط (من جدول admins).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out(405, { ok: false, error: "server" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pub = Deno.env.get("VAPID_PUBLIC_KEY");
    const priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!pub || !priv) return out(500, { ok: false, error: "not_configured" });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const db = createClient(url, srv);
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return out(401, { ok: false, error: "auth" });
    const { data: adm } = await db.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!adm) return out(403, { ok: false, error: "forbidden" });

    const b = await req.json().catch(() => ({}));
    const title = String(b.title || "").trim().slice(0, 60);
    const body = String(b.body || "").trim().slice(0, 180);
    if (title.length < 2 || body.length < 2) return out(400, { ok: false, error: "bad_input" });

    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:Vsob99@gmail.com", pub, priv);
    const payload = JSON.stringify({ title, body, url: "./", tag: "souq-" + Date.now() });

    const { data: subs, error } = await db.from("push_subs").select("id,endpoint,p256dh,auth").limit(5000);
    if (error) return out(500, { ok: false, error: "server" });

    let sent = 0;
    const dead: string[] = [];
    const list = subs || [];
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const res = await Promise.allSettled(chunk.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 })
      ));
      res.forEach((r, j) => {
        if (r.status === "fulfilled") sent++;
        else {
          const code = (r.reason as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) dead.push(chunk[j].id);
        }
      });
    }
    if (dead.length) await db.from("push_subs").delete().in("id", dead);
    return out(200, { ok: true, sent, removed: dead.length });
  } catch (_e) {
    return out(500, { ok: false, error: "server" });
  }
});
