# تشغيل الإشعارات — الخطوات مع الأكواد كاملة

مشروعك في Supabase: `paqxjptmmisybxlpyvsa`

> **تحذير:** هذا الملف فيه المفتاح السرّي. لا ترفعه مع ملفات الموقع ولا ترسله لأحد.

---

## الخطوة 1 — إنشاء الجدول (SQL)

1. افتح Supabase ثم **SQL Editor** ثم **New query**.
2. الصق الكود التالي كاملًا ثم اضغط **Run**:

```sql
-- جدول اشتراكات الإشعارات
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subs enable row level security;

-- أي زائر يستطيع الاشتراك فقط (لا يقرأ ولا يعدّل ولا يحذف)
drop policy if exists "push_subs_insert" on public.push_subs;
create policy "push_subs_insert" on public.push_subs
  for insert to anon, authenticated with check (true);

-- المدير فقط يرى عدد المشتركين
drop policy if exists "push_subs_admin_read" on public.push_subs;
create policy "push_subs_admin_read" on public.push_subs
  for select to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
```

3. تأكد من النجاح بتشغيل هذا في استعلام جديد (يجب أن يرجع الرقم 0):

```sql
select count(*) from public.push_subs;
```

---

## الخطوة 2 — المفتاحان السريان (Secrets)

### من لوحة التحكم
**Edge Functions** ثم **Secrets** ثم **Add new secret**، وأضف الاثنين:

| الاسم | القيمة |
|---|---|
| `VAPID_PUBLIC_KEY` | `BBK45OzhDA17mnlC8lqv0RfmXMwViX731y3jaM94yk21CBdrOtyMTmjnqOB5YsgI_P93MaLlw7Y9M2SdNnnuvHk` |
| `VAPID_PRIVATE_KEY` | `TIudRX6p0jAGuq9WSicVKT-0PxuxC-5xMh7DK6C5mrs` |

انسخ القيمة كما هي بلا مسافات في أولها أو آخرها.

### أو من الطرفية (بديل)
```bash
supabase login
supabase link --project-ref paqxjptmmisybxlpyvsa
supabase secrets set VAPID_PUBLIC_KEY=BBK45OzhDA17mnlC8lqv0RfmXMwViX731y3jaM94yk21CBdrOtyMTmjnqOB5YsgI_P93MaLlw7Y9M2SdNnnuvHk
supabase secrets set VAPID_PRIVATE_KEY=TIudRX6p0jAGuq9WSicVKT-0PxuxC-5xMh7DK6C5mrs
```

---

## الخطوة 3 — الدالة `send-push`

### من لوحة التحكم
1. **Edge Functions** ثم **Deploy a new function** ثم **Via Editor**.
2. الاسم بالضبط: `send-push`
3. احذف الكود التجريبي والصق الكود التالي كاملًا ثم **Deploy**:

```ts
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
```

### أو من الطرفية (بديل)
```bash
supabase functions new send-push
# استبدل محتوى supabase/functions/send-push/index.ts بالكود أعلاه، ثم:
supabase functions deploy send-push
```

إن ظهر خطأ 401 من البوابة نفسها فافتح إعدادات الدالة وأوقف خيار **Verify JWT**، فالدالة تتحقق من المدير بنفسها.

---

## الخطوة 4 — رفع الموقع

ارفع محتوى مجلد `site/` فقط، وهو: `index.html` و`admin.html` و`delivery.html` و`sw.js`.

---

## الاختبار

1. افتح الموقع على هاتفك: ستظهر شريحة «فعّل الإشعارات»، اضغط **تفعيل** ثم اسمح.
2. تأكد أن الاشتراك حُفظ، من SQL Editor:

```sql
select count(*) from public.push_subs;
```

3. ادخل لوحة الإدارة كمدير عام ثم تبويب **الإدارة** ثم بطاقة «إشعار لزبائن السوق»، واكتب عنوانًا ونصًّا ثم **إرسال**.

---

## إن لم يعمل

| الرسالة أو العَرَض | السبب والحل |
|---|---|
| دالة send-push غير منشورة | اسم الدالة غير مطابق، يجب أن يكون `send-push` بالضبط |
| مفاتيح الإشعارات غير مضبوطة | أحد السرّين ناقص أو مكتوب خطأ (الخطوة 2) |
| عدد المشتركين يظهر «—» | الخطوة 1 لم تُنفَّذ، أو لم تُنشأ السياسة (أعد تشغيل SQL) |
| لا تظهر شريحة التفعيل | المتصفح لا يدعم الإشعارات، أو الإذن محظور. على الآيفون يلزم إضافة التطبيق للشاشة الرئيسية (iOS 16.4 فأعلى) |
| الإذن محظور سابقًا | إعدادات الموقع في المتصفح ثم الإشعارات ثم سماح |

للتحقق من آخر أخطاء الدالة: **Edge Functions** ثم `send-push` ثم **Logs**.

---

## ملاحظات
- الخطة المجانية تسمح لكل طلب بثانيتين من وقت المعالج. مع مئات المشتركين لا مشكلة، ومع آلاف يلزم تقسيم الإرسال على دفعات.
- عند نشر عرض جديد من تبويب «العروض» يظهر للمدير العام خيار «أرسل إشعارًا للزبائن بهذا العرض».
