-- 1) تشخيص: شغّله أولًا (القيمتان الأوليان يجب أن تكونا true)
select
  has_table_privilege('anon','public.push_subs','insert')          as anon_can_insert,
  has_table_privilege('authenticated','public.push_subs','select') as admin_can_select,
  (select count(*) from pg_policies where schemaname='public' and tablename='push_subs') as policies;

-- 2) الإصلاح (آمن لإعادة التشغيل)
alter table public.push_subs enable row level security;

grant insert on public.push_subs to anon, authenticated;
grant select on public.push_subs to authenticated;
grant all    on public.push_subs to service_role;

drop policy if exists "push_subs_insert" on public.push_subs;
create policy "push_subs_insert" on public.push_subs
  for insert to anon, authenticated with check (true);

drop policy if exists "push_subs_admin_read" on public.push_subs;
create policy "push_subs_admin_read" on public.push_subs
  for select to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

notify pgrst, 'reload schema';
