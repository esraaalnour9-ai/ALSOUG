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
