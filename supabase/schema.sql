-- =====================================================================
-- R6T5 单词闯关 —— Supabase 业务库 schema（直连 + RLS + 防作弊 RPC）
-- 在 Supabase Dashboard → SQL Editor → New query 中整段执行一次即可。
-- 设计：
--   · profiles : 一人一行，存积分 credits / 会员 plan / 到期 / 上次签到
--   · books    : 自定义词书（收藏夹）
--   · levels   : 词书下的课时
--   · words    : 课时下的词条 en/phonetic/pos/cn
--   · 词书类数据用 RLS 直连读写；积分/签到/购买走 SECURITY DEFINER RPC，
--     以前端不可篡改的 auth.uid() 为准，防止直接改余额。
-- 执行前无需删除任何东西；可重复执行（create if not exists / or replace）。
-- =====================================================================

-- ---------- 1. profiles（会员与积分） ----------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  credits        integer not null default 0,
  plan           text    not null default 'free' check (plan in ('free','one','pro')),
  plan_expires   timestamptz,
  last_checkin   date,
  created_at      timestamptz not null default now()
);

-- 新用户注册自动建一行 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. books / levels / words（自定义词书） ----------
create table if not exists public.books (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.levels (
  id      uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  name    text not null
);

create table if not exists public.words (
  id        uuid primary key default gen_random_uuid(),
  level_id  uuid not null references public.levels(id) on delete cascade,
  en        text not null,
  phonetic  text not null default '',
  pos       text not null default '',
  cn        text not null default ''
);

create index if not exists idx_books_user   on public.books(user_id);
create index if not exists idx_levels_book on public.levels(book_id);
create index if not exists idx_words_level on public.words(level_id);

-- 大小写不敏感去重（表内联 unique 不支持表达式，用唯一索引实现）
create unique index if not exists books_user_name_uniq  on public.books(user_id, lower(name));
create unique index if not exists levels_book_name_uniq on public.levels(book_id, lower(name));
create unique index if not exists words_level_en_uniq    on public.words(level_id, lower(en));

-- ---------- 3. 行级安全 RLS ----------
alter table public.profiles enable row level security;
alter table public.books    enable row level security;
alter table public.levels   enable row level security;
alter table public.words   enable row level security;

-- profiles：只能读写自己那一行
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- books / levels / words：只能访问自己 user_id 下的数据
drop policy if exists books_owner on public.books;
create policy books_owner on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists levels_owner on public.levels;
create policy levels_owner on public.levels
  for all using (
    exists (select 1 from public.books b where b.id = levels.book_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.books b where b.id = levels.book_id and b.user_id = auth.uid())
  );

drop policy if exists words_owner on public.words;
create policy words_owner on public.words
  for all using (
    exists (select 1 from public.levels l join public.books b on b.id = l.book_id
            where l.id = words.level_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.levels l join public.books b on b.id = l.book_id
            where l.id = words.level_id and b.user_id = auth.uid())
  );

-- ---------- 4. 防作弊 RPC（服务端以 auth.uid() 为准） ----------

-- 4.1 读取自己的会员/积分状态（含今日是否已签到）
create or replace function public.get_my_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    insert into public.profiles (id) values (auth.uid()) returning * into p;
  end if;
  return jsonb_build_object(
    'credits', p.credits,
    'plan', p.plan,
    'plan_expires', p.plan_expires,
    'checked_in_today', (p.last_checkin = current_date)
  );
end; $$;
grant execute on function public.get_my_profile() to authenticated;

-- 4.2 每日签到：free +200，one/pro +600，一天一次
create or replace function public.do_checkin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; reward integer;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    insert into public.profiles (id) values (auth.uid()) returning * into p;
  end if;
  if p.last_checkin = current_date then
    return jsonb_build_object('ok', false, 'error', '今日已签到');
  end if;
  reward := case when p.plan in ('one','pro') then 600 else 200 end;
  update public.profiles
     set credits = credits + reward, last_checkin = current_date
   where id = auth.uid();
  return jsonb_build_object('ok', true, 'reward', reward);
end; $$;
grant execute on function public.do_checkin() to authenticated;

-- 4.3 积分直购 Club One（永久，扣 1500，仅 free 可买）
create or replace function public.buy_one()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.plan <> 'free' then
    return jsonb_build_object('ok', false, 'error', '当前计划无需重复购买');
  end if;
  if p.credits < 1500 then
    return jsonb_build_object('ok', false, 'error', '积分不足（需 1500）');
  end if;
  update public.profiles
     set credits = credits - 1500, plan = 'one', plan_expires = null
   where id = auth.uid();
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.buy_one() to authenticated;

-- 4.4 积分直购 Club One Pro（1 年，扣 666）
create or replace function public.buy_pro()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.plan = 'pro' then
    return jsonb_build_object('ok', false, 'error', '已是 Pro');
  end if;
  if p.credits < 666 then
    return jsonb_build_object('ok', false, 'error', '积分不足（需 666）');
  end if;
  update public.profiles
     set credits = credits - 666, plan = 'pro', plan_expires = now() + interval '365 days'
   where id = auth.uid();
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.buy_pro() to authenticated;
