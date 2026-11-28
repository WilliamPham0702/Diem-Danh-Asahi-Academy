-- =====================================================================
-- DIEM DANH ASAHI ACADEMY - schema cho Supabase (chay 1 lan trong SQL Editor)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Bang du lieu
-- ---------------------------------------------------------------------

-- Khoa bi mat dung de ky ma QR. Khong ai doc duoc tu web (khong co policy).
create table if not exists public.app_secret (
  id int primary key default 1 check (id = 1),
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into public.app_secret (id) values (1) on conflict do nothing;

-- Email admin / giang vien duoc phep dang ky tai khoan
create table if not exists public.allowed_staff (
  email text primary key,
  full_name text,
  role text not null check (role in ('admin', 'teacher')),
  -- ma moi: nguoi dang ky phai nhap dung ma nay (chong nguoi la chiem email giang vien)
  invite_code text not null default encode(extensions.gen_random_bytes(5), 'hex')
);

-- Danh sach hoc vien (nguon import tu Excel). Chi luu ma, ho ten, chuc danh. Khong luu email, khong luu cap quan ly.
-- Ma hoc vien luu dang CHU (text) de giu so 0 o dau, vd 000000089.
create table if not exists public.students (
  code text primary key,
  full_name text not null,
  title text
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('admin', 'teacher', 'student')),
  student_code text references public.students (code) on delete set null,
  device_id text,
  must_change_password boolean not null default false
);
create unique index if not exists profiles_student_code_uq
  on public.profiles (student_code) where student_code is not null;

create table if not exists public.class_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

create table if not exists public.class_type_sessions (
  id uuid primary key default gen_random_uuid(),
  class_type_id uuid not null references public.class_types (id) on delete cascade,
  session_no int not null,
  content text not null,
  unique (class_type_id, session_no)
);
-- Loai lop co the quy dinh ngay hoc (khong tinh T7, CN), ca (sang/chieu) va nguong canh bao vang
alter table public.class_types add column if not exists max_absent int;
alter table public.class_type_sessions add column if not exists day_no int;
alter table public.class_type_sessions add column if not exists shift text;
alter table public.class_type_sessions add column if not exists counts_absent boolean not null default true;
alter table public.class_type_sessions drop constraint if exists cts_shift_chk;
alter table public.class_type_sessions add constraint cts_shift_chk check (shift in ('sang', 'chieu'));

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  class_type_id uuid references public.class_types (id) on delete set null,
  start_date date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.classes add column if not exists graduation_date date;

create table if not exists public.class_students (
  class_id uuid not null references public.classes (id) on delete cascade,
  student_code text not null references public.students (code) on delete cascade,
  primary key (class_id, student_code)
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  session_no int not null,
  content text,
  session_date date,
  opened_at timestamptz,
  closed boolean not null default false,
  unique (class_id, session_no)
);
alter table public.class_sessions add column if not exists shift text;
alter table public.class_sessions add column if not exists counts_absent boolean not null default true;
-- Giang vien day buoi nay (mac dinh = nguoi tao lop, co the doi)
-- (email trong danh sach allowed_staff, giang vien chua tao tai khoan van gan duoc)
alter table public.class_sessions add column if not exists teacher_email text;
create index if not exists class_sessions_teacher_email_idx on public.class_sessions (teacher_email, session_date);
alter table public.class_sessions drop constraint if exists cs_shift_chk;
alter table public.class_sessions add constraint cs_shift_chk check (shift in ('sang', 'chieu'));

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  student_code text not null,
  student_name text,
  checked_at timestamptz not null default now(),
  device_id text,
  late boolean not null default false,
  source text not null default 'qr' check (source in ('qr', 'manual')),
  unique (session_id, student_code)
);
-- 1 thiet bi chi diem danh 1 lan / 1 buoi (diem danh thu cong khong co device_id)
create unique index if not exists attendance_session_device_uq
  on public.attendance (session_id, device_id) where device_id is not null;

-- ---------------------------------------------------------------------
-- 2. Ham tro giup phan quyen
-- ---------------------------------------------------------------------

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin', 'teacher'), false)
$$;

create or replace function public.my_student_code()
returns text language sql stable security definer set search_path = public as $$
  select student_code from public.profiles where id = auth.uid()
$$;

create or replace function public.can_manage_class(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.classes c where c.id = cid and c.created_by = auth.uid())
$$;

-- Quan ly lop HOAC la giang vien duoc gan day it nhat 1 buoi cua lop
create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid()
$$;
revoke all on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

create or replace function public.can_access_class(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_class(cid)
      or exists (select 1 from public.class_sessions s
                  where s.class_id = cid and s.teacher_email is not null and lower(s.teacher_email) = public.my_email())
$$;

-- Danh sach giang vien lay tu danh sach admin (allowed_staff), ke ca nguoi chua tao tai khoan. Khong tra ve ma moi.
create or replace function public.list_teachers()
returns table (email text, full_name text, role text, has_account boolean)
language sql stable security definer set search_path = public as $$
  select lower(a.email), a.full_name, a.role,
         exists (select 1 from public.profiles p where lower(p.email) = lower(a.email))
    from public.allowed_staff a
   where public.is_staff()
   order by a.full_name, a.email
$$;
revoke all on function public.list_teachers() from public, anon;
grant execute on function public.list_teachers() to authenticated;
revoke all on function public.can_access_class(uuid) from public, anon;
grant execute on function public.can_access_class(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Dang ky tai khoan: chi cho email nam trong danh sach
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.allowed_staff%rowtype;
  s public.students%rowtype;
  v_code text;
begin
  -- Giang vien / admin: email phai co trong danh sach va nhap dung ma moi
  select * into st from public.allowed_staff where lower(email) = lower(new.email);
  if found then
    if coalesce(trim(new.raw_user_meta_data ->> 'invite_code'), '') <> st.invite_code then
      raise exception 'INVITE_INVALID';
    end if;
    insert into public.profiles (id, email, full_name, role)
    values (new.id, new.email, coalesce(st.full_name, new.email), st.role);
    return new;
  end if;

  -- Hoc vien: tai khoan tu dong tao o lan dang nhap dau (ma hoc vien + mat khau mac dinh = ma).
  -- Email dang nhap bat buoc co dang <ma>@ten-mien, ma phai co trong danh sach lop.
  v_code := trim(coalesce(new.raw_user_meta_data ->> 'student_code', ''));
  select * into s from public.students where students.code = v_code;
  if not found or lower(split_part(new.email, '@', 1)) <> lower(v_code) then
    raise exception 'STUDENT_NOT_IN_LIST';
  end if;

  insert into public.profiles (id, email, full_name, role, student_code, must_change_password)
  values (new.id, new.email, s.full_name, 'student', s.code, true);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Ma QR xoay: ky bang HMAC, het han dung 10 giay (hang so v_ttl trong ham check_in)
-- ---------------------------------------------------------------------

create or replace function public.make_token(p_session uuid, p_ts bigint)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  sec text;
  payload text;
begin
  select secret into sec from public.app_secret where id = 1;
  payload := p_session::text || '.' || p_ts::text;
  return payload || '.' || encode(hmac(payload, sec, 'sha256'), 'hex');
end $$;

revoke all on function public.make_token(uuid, bigint) from public, anon, authenticated;

-- Giang vien goi ham nay moi 10 giay de lay ma moi
create or replace function public.get_qr_token(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  cs record;
begin
  select s.id, s.class_id, s.session_no, s.content, s.closed, c.name as class_name
    into cs
    from public.class_sessions s
    join public.classes c on c.id = s.class_id
   where s.id = p_session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_access_class(cs.class_id) then raise exception 'FORBIDDEN'; end if;
  if cs.closed then raise exception 'SESSION_CLOSED'; end if;

  update public.class_sessions
     set opened_at = coalesce(opened_at, now())
   where id = p_session;

  return jsonb_build_object(
    'token', public.make_token(p_session, extract(epoch from now())::bigint),
    'class_name', cs.class_name,
    'session_no', cs.session_no,
    'content', cs.content
  );
end $$;

-- Moc gio muon (gio Viet Nam): mo QR truoc 12:00 = buoi sang (9:00),
-- truoc 17:00 = buoi chieu (13:30), con lai = buoi toi (19:00).
-- Neu buoi hoc co khai bao ca (sang/chieu) thi theo ca, khong theo gio mo QR.
-- Ngay hoc dau tien cua lop (ngay dau tien mo diem danh) duoc du them 5 phut.
create or replace function public.late_deadline(p_session uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  with s as (
    select cs.class_id, cs.shift,
           (cs.opened_at at time zone 'Asia/Ho_Chi_Minh') as local_open
      from public.class_sessions cs where cs.id = p_session and cs.opened_at is not null
  ), first_day as (
    select min((x.opened_at at time zone 'Asia/Ho_Chi_Minh')::date) as d
      from public.class_sessions x join s on x.class_id = s.class_id
     where x.opened_at is not null
  )
  select (((s.local_open)::date
          + case when s.shift = 'sang' then time '09:00'
                 when s.shift = 'chieu' then time '13:30'
                 when s.local_open::time < time '12:00' then time '09:00'
                 when s.local_open::time < time '17:00' then time '13:30'
                 else time '19:00' end
          + case when (s.local_open)::date = (select d from first_day) then interval '5 minutes'
                 else interval '0' end)
         ) at time zone 'Asia/Ho_Chi_Minh'
    from s;
$$;
revoke all on function public.late_deadline(uuid) from public, anon;
grant execute on function public.late_deadline(uuid) to authenticated;

-- Hoc vien quet QR -> goi ham nay
create or replace function public.check_in(p_token text, p_device text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  p public.profiles%rowtype;
  st public.students%rowtype;
  sess record;
  parts text[];
  v_session uuid;
  v_ts bigint;
  v_now bigint;
  v_ttl constant int := 10;  -- ma QR chi hop le toi da 10 giay ke tu luc tao
  v_late boolean;
  v_checked timestamptz;
  msg_invalid constant text := 'Bạn đang điểm danh trên mã QR không hợp lệ do người khác chụp lại';
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or p.role <> 'student' or p.student_code is null then
    return jsonb_build_object('status', 'forbidden', 'message', 'Chỉ tài khoản học viên mới điểm danh được');
  end if;

  if p.must_change_password then
    return jsonb_build_object('status', 'must_change_password',
      'message', 'Bạn cần đổi mật khẩu trước khi điểm danh');
  end if;

  parts := string_to_array(coalesce(p_token, ''), '.');
  if array_length(parts, 1) is distinct from 3 then
    return jsonb_build_object('status', 'invalid', 'message', msg_invalid);
  end if;
  begin
    v_session := parts[1]::uuid;
    v_ts := parts[2]::bigint;
  exception when others then
    return jsonb_build_object('status', 'invalid', 'message', msg_invalid);
  end;
  if public.make_token(v_session, v_ts) <> p_token then
    return jsonb_build_object('status', 'invalid', 'message', msg_invalid);
  end if;

  select s.id, s.class_id, s.session_no, s.content, s.closed, s.opened_at,
         c.name as class_name
    into sess
    from public.class_sessions s
    join public.classes c on c.id = s.class_id
   where s.id = v_session;
  if not found then
    return jsonb_build_object('status', 'invalid', 'message', msg_invalid);
  end if;

  -- Da diem danh roi (quet lai ma cu hay ma moi deu bao nhu nhau)
  if exists (select 1 from public.attendance
              where session_id = v_session and student_code = p.student_code) then
    return jsonb_build_object('status', 'already',
      'message', 'Bạn đã điểm danh lớp này không cần điểm danh lại');
  end if;

  -- Ma het han (hoc vien khac chup lai gui di)
  v_now := extract(epoch from now())::bigint;
  if v_now - v_ts > v_ttl or v_ts > v_now then
    return jsonb_build_object('status', 'expired', 'message', msg_invalid);
  end if;

  if sess.closed then
    return jsonb_build_object('status', 'closed', 'message', 'Buổi học này đã đóng điểm danh');
  end if;

  if not exists (select 1 from public.class_students
                  where class_id = sess.class_id and student_code = p.student_code) then
    return jsonb_build_object('status', 'not_in_class', 'message', 'Bạn không có trong danh sách lớp này');
  end if;

  -- Khoa 1 thiet bi / 1 tai khoan
  if p_device is null or length(p_device) < 8 then
    return jsonb_build_object('status', 'invalid', 'message', 'Không nhận diện được thiết bị');
  end if;
  if p.device_id is not null and p.device_id <> p_device then
    return jsonb_build_object('status', 'device_mismatch',
      'message', 'Tài khoản này đã gắn với thiết bị khác. Hãy báo giảng viên để đặt lại thiết bị');
  end if;

  -- 1 thiet bi chi diem danh 1 lan / 1 buoi (chan 1 may quet ho nhieu tai khoan)
  if exists (select 1 from public.attendance
             where session_id = v_session and device_id = p_device) then
    return jsonb_build_object('status', 'device_used',
      'message', 'Thiết bị này đã dùng để điểm danh cho một tài khoản khác trong buổi học này');
  end if;

  if p.device_id is null then
    update public.profiles set device_id = p_device where id = p.id;
  end if;

  select * into st from public.students where code = p.student_code;

  begin
    insert into public.attendance (session_id, student_code, student_name, device_id, source)
    values (v_session, p.student_code, st.full_name, p_device, 'qr')
    on conflict (session_id, student_code) do nothing
    returning checked_at into v_checked;
  exception when unique_violation then
    return jsonb_build_object('status', 'device_used',
      'message', 'Thiết bị này đã dùng để điểm danh cho một tài khoản khác trong buổi học này');
  end;

  if v_checked is null then
    return jsonb_build_object('status', 'already',
      'message', 'Bạn đã điểm danh lớp này không cần điểm danh lại');
  end if;

  v_late := sess.opened_at is not null
        and v_checked > public.late_deadline(v_session);
  update public.attendance set late = v_late
   where session_id = v_session and student_code = p.student_code;

  return jsonb_build_object(
    'status', 'ok',
    'message', case when v_late then 'Điểm danh thành công (đến muộn)' else 'Điểm danh thành công' end,
    'late', v_late,
    'checked_at', v_checked,
    'class_name', sess.class_name,
    'session_no', sess.session_no,
    'content', sess.content,
    'student_code', st.code,
    'student_name', st.full_name
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. Cac ham quan tri
-- ---------------------------------------------------------------------

-- Cong n ngay lam viec (bo qua Thu Bay, Chu Nhat) vao ngay bat dau
create or replace function public.add_workdays(p_start date, p_n int)
returns date language plpgsql immutable as $$
declare
  d date := p_start;
  k int := 0;
begin
  while k < p_n loop
    d := d + 1;
    if extract(isodow from d) < 6 then k := k + 1; end if;
  end loop;
  return d;
end $$;

-- Tao lop: tu dong tao cac buoi hoc theo loai lop
drop function if exists public.create_class(text, uuid, date, text[]);
create or replace function public.create_class(
  p_name text, p_type uuid, p_start date, p_codes text[], p_grad date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;

  insert into public.classes (name, class_type_id, start_date, created_by)
  values (trim(p_name), p_type, p_start, auth.uid())
  returning id into cid;

  insert into public.class_sessions (class_id, session_no, content, session_date, shift, counts_absent, teacher_email)
  select cid, t.session_no, t.content,
         case when t.day_no is null then p_start + (t.session_no - 1)
              else public.add_workdays(p_start, t.day_no - 1) end,
         t.shift, t.counts_absent, public.my_email()
    from public.class_type_sessions t
   where t.class_type_id = p_type;

  insert into public.class_students (class_id, student_code)
  select cid, s.code from public.students s
   where upper(s.code) = any (select upper(trim(x)) from unnest(coalesce(p_codes, '{}')) x)
  on conflict do nothing;

  -- Ngay tot nghiep: mac dinh = ngay hoc cuoi cung, giang vien co the chon ngay khac
  update public.classes
     set graduation_date = coalesce(p_grad, (select max(session_date) from public.class_sessions where class_id = cid))
   where id = cid;

  return cid;
end $$;

-- Dat lai thiet bi cho hoc vien (khi doi dien thoai)
create or replace function public.reset_device(p_student_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  update public.profiles set device_id = null where student_code = p_student_code;
end $$;

-- Hoc vien doi mat khau xong -> bo co "phai doi mat khau"
create or replace function public.password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set must_change_password = false where id = auth.uid();
end $$;

-- Dat lai mat khau hoc vien: xoa tai khoan dang nhap. Lan dang nhap sau (ma + ma) tai khoan
-- duoc tao lai voi mat khau mac dinh = ma hoc vien va bat buoc doi mat khau. Lich su diem danh giu nguyen.
create or replace function public.reset_student_account(p_student_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  delete from auth.users
   where id in (select id from public.profiles where student_code = p_student_code and role = 'student');
end $$;

-- Hoc vien tu dat lai mat khau tren man hinh dang nhap (khong can dang nhap):
-- xoa tai khoan dang nhap, lan dang nhap sau (ma + ma) tao lai voi mat khau mac dinh va bat buoc doi.
create or replace function public.reset_password_by_code(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.students where code = trim(p_code)) then
    raise exception 'STUDENT_NOT_IN_LIST';
  end if;
  delete from auth.users
   where id in (select id from public.profiles where student_code = trim(p_code) and role = 'student');
end $$;

-- Admin xoa tai khoan (hoc vien hoac giang vien)
create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_DELETE_SELF'; end if;
  delete from auth.users where id = p_user;
end $$;

-- Chi cho nguoi da dang nhap goi cac ham cong khai
revoke all on function public.get_qr_token(uuid) from public, anon;
revoke all on function public.check_in(text, text) from public, anon;
revoke all on function public.create_class(text, uuid, date, text[], date) from public, anon;
revoke all on function public.reset_device(text) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
revoke all on function public.password_changed() from public, anon;
revoke all on function public.reset_student_account(text) from public, anon;
grant execute on function public.password_changed() to authenticated;
grant execute on function public.reset_student_account(text) to authenticated;
revoke all on function public.reset_password_by_code(text) from public;
grant execute on function public.reset_password_by_code(text) to anon, authenticated;
grant execute on function public.get_qr_token(uuid) to authenticated;
grant execute on function public.check_in(text, text) to authenticated;
grant execute on function public.create_class(text, uuid, date, text[], date) to authenticated;
grant execute on function public.reset_device(text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------

alter table public.app_secret enable row level security;
alter table public.allowed_staff enable row level security;
alter table public.students enable row level security;
alter table public.profiles enable row level security;
alter table public.class_types enable row level security;
alter table public.class_type_sessions enable row level security;
alter table public.classes enable row level security;
alter table public.class_students enable row level security;
alter table public.class_sessions enable row level security;
alter table public.attendance enable row level security;

-- allowed_staff: chi admin
drop policy if exists allowed_staff_admin on public.allowed_staff;
create policy allowed_staff_admin on public.allowed_staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: xem cua minh, staff xem tat ca. Khong ghi truc tiep.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());

-- students
drop policy if exists students_select on public.students;
create policy students_select on public.students
  for select to authenticated using (public.is_staff() or code = public.my_student_code());
drop policy if exists students_insert on public.students;
create policy students_insert on public.students
  for insert to authenticated with check (public.is_staff());
drop policy if exists students_update on public.students;
create policy students_update on public.students
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists students_delete on public.students;
create policy students_delete on public.students
  for delete to authenticated using (public.is_admin());

-- class_types / class_type_sessions: staff xem, admin sua
drop policy if exists class_types_select on public.class_types;
create policy class_types_select on public.class_types
  for select to authenticated using (public.is_staff());
drop policy if exists class_types_admin on public.class_types;
create policy class_types_admin on public.class_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists cts_select on public.class_type_sessions;
create policy cts_select on public.class_type_sessions
  for select to authenticated using (public.is_staff());
drop policy if exists cts_admin on public.class_type_sessions;
create policy cts_admin on public.class_type_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- classes (tao lop qua ham create_class)
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
  for select to authenticated using (
    public.can_access_class(id)
    or exists (select 1 from public.class_students cs
                where cs.class_id = classes.id and cs.student_code = public.my_student_code())
  );
drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes
  for update to authenticated using (public.can_manage_class(id)) with check (public.can_manage_class(id));
drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes
  for delete to authenticated using (public.can_manage_class(id));

-- class_students
drop policy if exists cs_select on public.class_students;
create policy cs_select on public.class_students
  for select to authenticated using (
    public.can_access_class(class_id) or student_code = public.my_student_code()
  );
drop policy if exists cs_insert on public.class_students;
create policy cs_insert on public.class_students
  for insert to authenticated with check (public.can_manage_class(class_id));
drop policy if exists cs_delete on public.class_students;
create policy cs_delete on public.class_students
  for delete to authenticated using (public.can_manage_class(class_id));

-- class_sessions
drop policy if exists sessions_select on public.class_sessions;
create policy sessions_select on public.class_sessions
  for select to authenticated using (
    public.can_access_class(class_id)
    or exists (select 1 from public.class_students cs
                where cs.class_id = class_sessions.class_id and cs.student_code = public.my_student_code())
  );
drop policy if exists sessions_update on public.class_sessions;
create policy sessions_update on public.class_sessions
  for update to authenticated using (public.can_access_class(class_id)) with check (public.can_access_class(class_id));

-- attendance: hoc vien xem cua minh; staff xem/diem danh tay/huy trong lop minh quan ly
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated using (
    student_code = public.my_student_code()
    or exists (select 1 from public.class_sessions s
                where s.id = attendance.session_id and public.can_access_class(s.class_id))
  );
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated with check (
    source = 'manual'
    and exists (select 1 from public.class_sessions s
                 where s.id = attendance.session_id and public.can_access_class(s.class_id))
  );
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated using (
    exists (select 1 from public.class_sessions s
             where s.id = attendance.session_id and public.can_access_class(s.class_id))
  );

-- ---------------------------------------------------------------------
-- 7. Tao admin dau tien (sua email roi chay), sau do vao web Dang ky
-- ---------------------------------------------------------------------
-- insert into public.allowed_staff (email, full_name, role, invite_code)
-- values ('email-cua-ban@gmail.com', 'Pham Nhut Thanh', 'admin', 'DAT-MA-MOI-O-DAY');

-- ---------------------------------------------------------------------
-- Quyen truy cap bang cho vai tro dang nhap (RLS van gioi han tung dong).
-- Supabase moi khong tu cap quyen cho bang tao bang SQL, nen phai cap ro rang.
-- KHONG cap cho app_secret (khoa ky QR).
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.allowed_staff, public.students, public.profiles, public.class_types,
  public.class_type_sessions, public.classes, public.class_students,
  public.class_sessions, public.attendance
  to authenticated;
revoke all on public.app_secret from anon, authenticated;

-- ---------------------------------------------------------------------
-- Loai lop mau: LPFC-FullTime (2 tuan, 10 ngay hoc, moi ngay 2 buoi sang/chieu, nghi T7 CN)
-- Canh bao khi hoc vien vang qua 2 buoi. Chi tao neu chua co.
-- ---------------------------------------------------------------------
do $$
declare
  tid uuid;
begin
  if exists (select 1 from public.class_types where name = 'LPFC-FullTime') then return; end if;
  insert into public.class_types (name, description, max_absent)
  values ('LPFC-FullTime', 'Lộ trình đào tạo LP Fulltime, 2 tuần (10 ngày học, nghỉ Thứ Bảy và Chủ Nhật). Sáng 9:00-12:00, chiều 13:30-17:00', 2)
  returning id into tid;

  insert into public.class_type_sessions (class_type_id, session_no, day_no, shift, content)
  select tid, v.n, v.d, v.sh, v.c from (values
    (1, 1, 'sang',  'Tổng quan Asahi Life. Tổng quan ngành bảo hiểm: nguồn gốc, khái niệm, vai trò đại lý bảo hiểm'),
    (2, 1, 'chieu', 'Kiến thức chung ngành bảo hiểm: thuật ngữ, điều khoản, nguyên tắc cơ bản'),
    (3, 2, 'sang',  'Pháp luật trong kinh doanh bảo hiểm'),
    (4, 2, 'chieu', 'Nghiệp vụ bảo hiểm, quyền và nghĩa vụ của doanh nghiệp'),
    (5, 3, 'sang',  'Ôn tập và giải đề theo các chủ đề đã học'),
    (6, 3, 'chieu', 'Kiểm tra đánh giá điều kiện dự thi MOF'),
    (7, 4, 'sang',  'Thi MOF'),
    (8, 4, 'chieu', 'Thi MOF'),
    (9, 5, 'sang',  'Compliance và Quy tắc ứng xử'),
    (10, 5, 'chieu', 'Chính sách thu nhập LP và PM'),
    (11, 6, 'sang',  'Tổng quan Tập đoàn Asahi và Asahi Life Việt Nam'),
    (12, 6, 'chieu', 'Kokoro 101 và Omotenashi 101'),
    (13, 7, 'sang',  'Kỹ năng bán hàng: Tìm kiếm khách hàng tiềm năng'),
    (14, 7, 'chieu', 'Kỹ năng hoạch định tài chính, Ứng dụng AI. Kỹ năng bán hàng: Phân tích nhu cầu'),
    (15, 8, 'sang',  'Kỹ năng bán hàng: Xử lý từ chối'),
    (16, 8, 'chieu', 'Sản phẩm UL'),
    (17, 9, 'sang',  'Kỹ năng bán hàng: Thiết kế giải pháp'),
    (18, 9, 'chieu', 'Kỹ năng bán hàng: Trình bày và chốt hợp đồng'),
    (19, 10, 'sang',  'Hướng dẫn ePOS và thực hành'),
    (20, 10, 'chieu', 'Kiểm tra đánh giá. Ký hợp đồng và Tổng kết')
  ) as v(n, d, sh, c);
end $$;

-- Thi MOF khong tinh vao so buoi vang
update public.class_type_sessions set counts_absent = false
 where content = 'Thi MOF';

-- Loai lop mau: LPFC-Parttime (7 ngay hoc, 14 buoi, nghi T7 CN). Thi MOF khong tinh vang. Chi tao neu chua co.
do $$
declare tid uuid;
begin
  if exists (select 1 from public.class_types where name = 'LPFC-Parttime') then return; end if;
  insert into public.class_types (name, description, max_absent)
  values ('LPFC-Parttime', 'Lộ trình đào tạo LP Parttime, 7 ngày học (nghỉ Thứ Bảy và Chủ Nhật). Sáng 9:00-12:00, chiều 13:30-16:30, học online qua MS Teams. M1: học từ ngày 1 (chưa có chứng chỉ). M2: học từ ngày 5, buổi Compliance (đã có chứng chỉ)', 2)
  returning id into tid;
  insert into public.class_type_sessions (class_type_id, session_no, day_no, shift, content, counts_absent)
  select tid, v.n, v.d, v.sh, v.c, v.ca from (values
    (1, 1, 'sang',  'Tổng quan Asahi Life. Tổng quan ngành bảo hiểm', true),
    (2, 1, 'chieu', 'Kiến thức chung ngành bảo hiểm', true),
    (3, 2, 'sang',  'Pháp luật trong kinh doanh bảo hiểm', true),
    (4, 2, 'chieu', 'Nghiệp vụ bảo hiểm, quyền và nghĩa vụ doanh nghiệp', true),
    (5, 3, 'sang',  'Ôn tập và giải đề', true),
    (6, 3, 'chieu', 'Kiểm tra đánh giá điều kiện dự thi MOF', true),
    (7, 4, 'sang',  'Thi MOF', false),
    (8, 4, 'chieu', 'Thi MOF', false),
    (9, 5, 'sang',  'Compliance và Quy tắc ứng xử', true),
    (10, 5, 'chieu', 'Chính sách thu nhập LP và UM', true),
    (11, 6, 'sang',  'Kokoro 101 và Omotenashi 101. Hoạch định tài chính. Ứng dụng AI', true),
    (12, 6, 'chieu', 'Sản phẩm UL', true),
    (13, 7, 'sang',  'Hướng dẫn ePOS Tutorial và Practice', true),
    (14, 7, 'chieu', 'Kiểm tra đánh giá. Ký hợp đồng và Tốt nghiệp', true)
  ) as v(n, d, sh, c, ca);
end $$;

-- Lop da tao truoc do: gan nguoi tao lop lam giang vien
update public.class_sessions cs set teacher_email = lower(p.email)
  from public.classes c join public.profiles p on p.id = c.created_by
 where c.id = cs.class_id and cs.teacher_email is null;

-- ===== QR: quy tắc mở/đóng theo buổi (2026-11-28) =====
alter table public.class_sessions add column if not exists qr_reset_until timestamptz;
-- (định nghĩa qr_window, get_qr_token, close_qr, admin_reset_qr, guard_session_update, trigger class_sessions_guard
--  đã chạy trên Supabase; xem lịch sử commit/chat nếu cần tạo lại từ đầu)

-- v21: dia diem hoc, mo dang ky, trang chu hoc vien (da ap dung tren DB)
-- alter table classes add column location text, add column open_enrollment boolean not null default false;
-- Ham: list_open_classes(), enroll_class(p_class uuid), my_open_sessions(); check_in khong con chan must_change_password.

-- v26: bao cao gio day (admin): ham teaching_hours(p_from date, p_to date), sang=4h, chieu/toi=5h (da ap dung tren DB)

-- v32 (da ap dung tren DB): vi tri diem danh (attendance.lat/lng/acc_m/dist_m/out_of_area, classes.lat/lng/radius_m),
-- ket thuc lop (classes.ended_at/ended_by, end_class, reopen_class, class_ended, classes_guard), nhat ky sua diem danh (attendance_log),
-- khoa dang nhap 5 lan/10 phut (login_attempts, login_status, login_fail, login_ok), check_in(p_token,p_device,p_lat,p_lng,p_acc),
-- thu hoi quyen anon: chi con reset_password_by_code, login_status, login_fail.
-- ===== v38: Tro giang =====
create table if not exists public.teaching_assistants(
  student_code text primary key references public.students(code) on delete cascade,
  added_by uuid, added_at timestamptz not null default now());
alter table public.teaching_assistants enable row level security;
drop policy if exists ta_select on public.teaching_assistants;
create policy ta_select on public.teaching_assistants for select to authenticated
  using (public.is_staff() or student_code = public.my_student_code());
revoke all on public.teaching_assistants from anon, authenticated;
grant select on public.teaching_assistants to authenticated;

alter table public.classes add column if not exists ta_email text;
alter table public.class_sessions add column if not exists ta_email text;

create table if not exists public.qr_openers(
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  user_id uuid not null, lat double precision, lng double precision,
  seen_at timestamptz not null default now(), active boolean not null default true,
  primary key (session_id, user_id));
alter table public.qr_openers enable row level security;
revoke all on public.qr_openers from anon, authenticated;

create or replace function public.ta_email_of(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select lower(email) from public.profiles where student_code = p_code limit 1), lower(p_code) || '@asahilife.com') $$;

create or replace function public.valid_ta_email(e text) returns boolean
language sql stable security definer set search_path = public as $$
  select e is null
      or exists (select 1 from public.allowed_staff a where lower(a.email) = lower(e))
      or exists (select 1 from public.teaching_assistants t where public.ta_email_of(t.student_code) = lower(e)) $$;

create or replace function public.list_tas() returns table(code text, full_name text, title text, email text, has_account boolean)
language sql stable security definer set search_path = public as $$
  select t.student_code, s.full_name, s.title, public.ta_email_of(t.student_code),
         exists (select 1 from public.profiles p where p.student_code = t.student_code)
    from public.teaching_assistants t join public.students s on s.code = t.student_code
   where public.is_staff() order by s.full_name $$;

create or replace function public.set_ta(p_code text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.students where code = p_code) then raise exception 'STUDENT_NOT_FOUND'; end if;
  if p_on then
    insert into public.teaching_assistants(student_code, added_by) values (p_code, auth.uid()) on conflict do nothing;
  else
    v_email := public.ta_email_of(p_code);
    delete from public.teaching_assistants where student_code = p_code;
    update public.class_sessions set ta_email = null where lower(ta_email) = v_email;
    update public.classes set ta_email = null where lower(ta_email) = v_email;
  end if;
end $$;

-- classes: kiem tra tro giang hop le + dong bo cac buoi
create or replace function public.classes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ended_at is distinct from old.ended_at or new.ended_by is distinct from old.ended_by then
    if new.ended_at is null then
      if not coalesce(public.is_admin(), false) then raise exception 'ONLY_ADMIN_REOPEN'; end if;
    else
      if not (coalesce(public.is_admin(), false) or old.created_by = auth.uid()) then raise exception 'ONLY_CREATOR_END'; end if;
    end if;
  end if;
  if new.created_by is distinct from old.created_by and not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN'; end if;
  if new.ta_email is distinct from old.ta_email then
    new.ta_email := nullif(lower(btrim(new.ta_email)), '');
    if auth.uid() is not null and not public.can_manage_class(old.id) then raise exception 'FORBIDDEN'; end if;
    if not public.valid_ta_email(new.ta_email) then raise exception 'INVALID_TA'; end if;
  end if;
  return new;
end $$;

create or replace function public.classes_ta_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.class_sessions set ta_email = new.ta_email
   where class_id = new.id and ta_email is not null and lower(ta_email) is distinct from lower(coalesce(new.ta_email, ''));
  return null;
end $$;
drop trigger if exists classes_ta_sync_trg on public.classes;
create trigger classes_ta_sync_trg after update of ta_email on public.classes
  for each row when (old.ta_email is distinct from new.ta_email) execute function public.classes_ta_sync();

create or replace function public.guard_session_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) and auth.uid() is not null then
    if new.qr_reset_until is distinct from old.qr_reset_until then new.qr_reset_until := old.qr_reset_until; end if;
    if old.opened_at is not null and new.session_date is distinct from old.session_date then new.session_date := old.session_date; end if;
  end if;
  if new.ta_email is distinct from old.ta_email then
    new.ta_email := nullif(lower(btrim(new.ta_email)), '');
    if auth.uid() is not null and new.ta_email is not null
       and new.ta_email is distinct from (select lower(c.ta_email) from public.classes c where c.id = new.class_id) then
      raise exception 'INVALID_TA';
    end if;
  end if;
  return new;
end $$;

create or replace function public.can_open_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_sessions s where s.id = p_session
    and (public.can_access_class(s.class_id)
         or (s.ta_email is not null and lower(s.ta_email) = public.my_email()
             and (public.is_staff() or exists (select 1 from public.teaching_assistants t where t.student_code = public.my_student_code()))))) $$;

drop function if exists public.get_qr_token(uuid, boolean);
create or replace function public.get_qr_token(p_session uuid, p_reopen boolean default false, p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare cs record; w record; d timestamptz; v_reset boolean; o record; v_dist double precision;
begin
  select s.id, s.class_id, s.session_no, s.content, s.session_date, s.shift, s.opened_at, s.qr_reset_until, s.teacher_email, s.ta_email, c.name as class_name
    into cs from public.class_sessions s join public.classes c on c.id = s.class_id where s.id = p_session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_open_session(p_session) then raise exception 'FORBIDDEN'; end if;
  if public.class_ended(cs.class_id) then raise exception 'CLASS_ENDED'; end if;
  if cs.teacher_email is null and cs.ta_email is null then raise exception 'NO_TEACHER'; end if;
  v_reset := cs.qr_reset_until is not null and now() <= cs.qr_reset_until;
  select * into w from public.qr_window(cs.session_date, cs.shift);
  d := public.qr_deadline(cs.session_date, cs.shift);
  if not v_reset then
    if w.w_start is null or now() > w.w_end then raise exception 'OUT_OF_SESSION'; end if;
    if now() < w.w_start then raise exception 'NOT_YET'; end if;
    if d is not null and now() > d and not coalesce(p_reopen, false) then return jsonb_build_object('error', 'QR_EXPIRED'); end if;
  end if;
  -- nguoi khac dang mo QR cua buoi nay: chi cho mo them neu cung vi tri (<= 200 m)
  for o in select * from public.qr_openers where session_id = p_session and user_id <> auth.uid() and active and seen_at > now() - interval '40 seconds' loop
    if p_lat is null or p_lng is null or o.lat is null or o.lng is null then raise exception 'QR_OTHER_OPENER'; end if;
    v_dist := 6371000 * 2 * asin(least(1, sqrt(power(sin(radians(p_lat - o.lat) / 2), 2)
              + cos(radians(o.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - o.lng) / 2), 2))));
    if v_dist > 200 then raise exception 'QR_OTHER_OPENER'; end if;
  end loop;
  insert into public.qr_openers(session_id, user_id, lat, lng, seen_at, active) values (p_session, auth.uid(), p_lat, p_lng, now(), true)
    on conflict (session_id, user_id) do update set lat = coalesce(excluded.lat, public.qr_openers.lat), lng = coalesce(excluded.lng, public.qr_openers.lng), seen_at = now(), active = true;
  update public.class_sessions set closed = false, opened_at = coalesce(opened_at, now()) where id = p_session;
  return jsonb_build_object('token', public.make_token(p_session, extract(epoch from now())::bigint), 'class_name', cs.class_name, 'session_no', cs.session_no, 'content', cs.content);
end $$;

create or replace function public.close_qr(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_open_session(p_session) then raise exception 'FORBIDDEN'; end if;
  update public.qr_openers set active = false where session_id = p_session and user_id = auth.uid();
  if not exists (select 1 from public.qr_openers where session_id = p_session and active and seen_at > now() - interval '40 seconds') then
    update public.class_sessions set closed = true where id = p_session and opened_at is not null;
  end if;
end $$;

create or replace function public.qr_info(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.can_open_session(p_session) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('id', s.id, 'session_no', s.session_no, 'content', s.content, 'closed', s.closed, 'class_id', c.id, 'class_name', c.name,
    'total', (select count(*) from public.class_students cs where cs.class_id = c.id),
    'count', (select count(*) from public.attendance a where a.session_id = s.id),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('student_name', x.student_name, 'checked_at', x.checked_at))
                          from (select student_name, checked_at from public.attendance where session_id = s.id order by checked_at desc limit 8) x), '[]'::jsonb))
    into r from public.class_sessions s join public.classes c on c.id = s.class_id where s.id = p_session;
  return r;
end $$;

create or replace function public.my_ta_sessions(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'session_no', s.session_no, 'content', s.content, 'session_date', s.session_date,
      'shift', s.shift, 'closed', s.closed, 'opened_at', s.opened_at, 'qr_reset_until', s.qr_reset_until, 'class_id', c.id, 'class_name', c.name)
      order by s.session_date, s.session_no), '[]'::jsonb)
    from public.class_sessions s join public.classes c on c.id = s.class_id
   where s.ta_email is not null and lower(s.ta_email) = public.my_email() and c.ended_at is null
     and s.session_date between p_from and p_to
     and (public.is_staff() or exists (select 1 from public.teaching_assistants t where t.student_code = public.my_student_code())) $$;

-- phan quyen ham
revoke all on function public.ta_email_of(text), public.valid_ta_email(text), public.can_open_session(uuid), public.classes_ta_sync() from public, anon, authenticated;
revoke all on function public.list_tas(), public.set_ta(text, boolean), public.get_qr_token(uuid, boolean, double precision, double precision),
  public.close_qr(uuid), public.qr_info(uuid), public.my_ta_sessions(date, date) from public, anon;
grant execute on function public.list_tas(), public.set_ta(text, boolean), public.get_qr_token(uuid, boolean, double precision, double precision),
  public.close_qr(uuid), public.qr_info(uuid), public.my_ta_sessions(date, date) to authenticated;
create or replace function public.get_qr_token(p_session uuid, p_reopen boolean default false, p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare cs record; w record; d timestamptz; v_reset boolean; o record; v_dist double precision; v_ta boolean;
begin
  select s.id, s.class_id, s.session_no, s.content, s.session_date, s.shift, s.opened_at, s.qr_reset_until, s.teacher_email, s.ta_email, c.name as class_name
    into cs from public.class_sessions s join public.classes c on c.id = s.class_id where s.id = p_session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_open_session(p_session) then raise exception 'FORBIDDEN'; end if;
  if public.class_ended(cs.class_id) then raise exception 'CLASS_ENDED'; end if;
  if cs.teacher_email is null and cs.ta_email is null then raise exception 'NO_TEACHER'; end if;
  v_reset := cs.qr_reset_until is not null and now() <= cs.qr_reset_until;
  select * into w from public.qr_window(cs.session_date, cs.shift);
  d := public.qr_deadline(cs.session_date, cs.shift);
  if not v_reset then
    if w.w_start is null or now() > w.w_end then raise exception 'OUT_OF_SESSION'; end if;
    if now() < w.w_start then raise exception 'NOT_YET'; end if;
    if d is not null and now() > d and not coalesce(p_reopen, false) then return jsonb_build_object('error', 'QR_EXPIRED'); end if;
  end if;
  -- chi tro giang bi han che: giang vien (hoac nguoi quan ly lop) luon duoc mo
  v_ta := lower(coalesce(cs.teacher_email,'')) <> public.my_email() and not public.can_manage_class(cs.class_id);
  -- nguoi khac dang mo QR cua buoi nay: chi cho mo them neu cung vi tri (<= 200 m)
  if v_ta then for o in select * from public.qr_openers where session_id = p_session and user_id <> auth.uid() and active and seen_at > now() - interval '40 seconds' loop
    if p_lat is null or p_lng is null or o.lat is null or o.lng is null then raise exception 'QR_OTHER_OPENER'; end if;
    v_dist := 6371000 * 2 * asin(least(1, sqrt(power(sin(radians(p_lat - o.lat) / 2), 2)
              + cos(radians(o.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - o.lng) / 2), 2))));
    if v_dist > 200 then raise exception 'QR_OTHER_OPENER'; end if;
  end loop; end if;
  insert into public.qr_openers(session_id, user_id, lat, lng, seen_at, active) values (p_session, auth.uid(), p_lat, p_lng, now(), true)
    on conflict (session_id, user_id) do update set lat = coalesce(excluded.lat, public.qr_openers.lat), lng = coalesce(excluded.lng, public.qr_openers.lng), seen_at = now(), active = true;
  update public.class_sessions set closed = false, opened_at = coalesce(opened_at, now()) where id = p_session;
  return jsonb_build_object('token', public.make_token(p_session, extract(epoch from now())::bigint), 'class_name', cs.class_name, 'session_no', cs.session_no, 'content', cs.content);
end $$;
-- v42: thu hoi quyen goi RPC cua ham trigger
revoke execute on function public.guard_session_update(), public.handle_new_user() from public, anon, authenticated;

-- ===== v43: Khoa hoc nhieu cap (khoa > module > nhom), gan hoc vien theo module =====
create table if not exists public.course_nodes (
  id uuid primary key default gen_random_uuid(),
  class_type_id uuid not null references public.class_types (id) on delete cascade,
  parent_id uuid references public.course_nodes (id) on delete cascade,
  code text not null,
  sort_no int not null default 0,
  max_absent int default 1
);
create unique index if not exists course_nodes_uq on public.course_nodes
  (class_type_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(code));
alter table public.course_nodes enable row level security;
drop policy if exists cn_select on public.course_nodes;
create policy cn_select on public.course_nodes for select to authenticated using (true);
drop policy if exists cn_admin on public.course_nodes;
create policy cn_admin on public.course_nodes for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.course_nodes to authenticated;

alter table public.class_type_sessions add column if not exists node_id uuid references public.course_nodes (id) on delete set null;
alter table public.class_sessions add column if not exists node_id uuid references public.course_nodes (id) on delete set null;
alter table public.class_students add column if not exists node_ids uuid[];  -- null = hoc tat ca module

-- Du lieu hien co: LPFC-F (M1 = buoi 1-8, M2 = buoi 9-20, 12 nhom) va LPFC-P (M1 = 1-8, M2 = 9-14)
do $$
declare t uuid; m1 uuid; m2 uuid; n uuid; i int;
  codes text[] := array['TT','CS','CT','VH','SC1','SC2','SC3','UL','SC4','SC5','EPOS','Active'];
begin
  select id into t from public.class_types where name in ('LPFC-FullTime', 'LPFC-F') limit 1;
  if t is not null and not exists (select 1 from public.course_nodes where class_type_id = t) then
    update public.class_types set name = 'LPFC-F' where id = t;
    insert into public.course_nodes (class_type_id, code, sort_no) values (t, 'M1', 1) returning id into m1;
    insert into public.course_nodes (class_type_id, code, sort_no) values (t, 'M2', 2) returning id into m2;
    update public.class_type_sessions set node_id = m1 where class_type_id = t and session_no <= 8;
    for i in 1..12 loop
      insert into public.course_nodes (class_type_id, parent_id, code, sort_no, max_absent) values (t, m2, codes[i], i, null) returning id into n;
      update public.class_type_sessions set node_id = n where class_type_id = t and session_no = 8 + i;
    end loop;
  end if;
  select id into t from public.class_types where name in ('LPFC-Parttime', 'LPFC-P') limit 1;
  if t is not null and not exists (select 1 from public.course_nodes where class_type_id = t) then
    update public.class_types set name = 'LPFC-P' where id = t;
    insert into public.course_nodes (class_type_id, code, sort_no) values (t, 'M1', 1) returning id into m1;
    insert into public.course_nodes (class_type_id, code, sort_no) values (t, 'M2', 2) returning id into m2;
    update public.class_type_sessions set node_id = m1 where class_type_id = t and session_no <= 8;
    update public.class_type_sessions set node_id = m2 where class_type_id = t and session_no > 8;
  end if;
  update public.class_sessions cs set node_id = cts.node_id
    from public.classes c, public.class_type_sessions cts
   where cs.class_id = c.id and cts.class_type_id = c.class_type_id and cts.session_no = cs.session_no and cs.node_id is null;
end $$;

-- Kiem tra danh sach node thuoc dung khoa cua lop
create or replace function public.nodes_ok(p_class uuid, p_nodes uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select p_nodes is null or not exists (
    select 1 from unnest(p_nodes) x
     where not exists (select 1 from public.course_nodes n join public.classes c on c.class_type_id = n.class_type_id
                        where n.id = x and c.id = p_class));
$$;

-- Them hoc vien vao lop kem module (p_nodes null/rong = hoc tat ca module). Gop module neu da co trong lop.
create or replace function public.add_class_students(p_class uuid, p_codes text[], p_nodes uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nodes uuid[] := case when p_nodes is null or cardinality(p_nodes) = 0 then null else p_nodes end;
  v_codes text[]; v_added int := 0; v_upd int := 0; v_missing text[]; c text; ex record;
begin
  if not public.can_manage_class(p_class) then raise exception 'FORBIDDEN'; end if;
  if not public.nodes_ok(p_class, v_nodes) then raise exception 'INVALID_NODE'; end if;
  select array_agg(distinct trim(x)) into v_codes from unnest(coalesce(p_codes, '{}')) x where trim(x) <> '';
  select coalesce(array_agg(c2), '{}') into v_missing from unnest(coalesce(v_codes, '{}')) c2
   where not exists (select 1 from public.students s where s.code = c2);
  foreach c in array coalesce(v_codes, '{}') loop
    continue when c = any (v_missing);
    select * into ex from public.class_students where class_id = p_class and student_code = c;
    if not found then
      insert into public.class_students (class_id, student_code, node_ids) values (p_class, c, v_nodes);
      v_added := v_added + 1;
    elsif ex.node_ids is not null then
      update public.class_students set node_ids = case when v_nodes is null then null
          else (select array_agg(distinct u) from unnest(ex.node_ids || v_nodes) u) end
       where class_id = p_class and student_code = c;
      v_upd := v_upd + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_upd, 'missing', to_jsonb(v_missing));
end $$;

-- Dat lai danh sach module cua 1 hoc vien trong lop (null/rong = tat ca)
create or replace function public.set_student_nodes(p_class uuid, p_code text, p_nodes uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_nodes uuid[] := case when p_nodes is null or cardinality(p_nodes) = 0 then null else p_nodes end;
begin
  if not public.can_manage_class(p_class) then raise exception 'FORBIDDEN'; end if;
  if not public.nodes_ok(p_class, v_nodes) then raise exception 'INVALID_NODE'; end if;
  update public.class_students set node_ids = v_nodes where class_id = p_class and student_code = p_code;
  if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
end $$;

-- create_class: them p_nodes, chep node_id sang cac buoi
drop function if exists public.create_class(text, uuid, date, text[], date);
create or replace function public.create_class(
  p_name text, p_type uuid, p_start date, p_codes text[], p_grad date default null, p_nodes uuid[] default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; v_nodes uuid[] := case when p_nodes is null or cardinality(p_nodes) = 0 then null else p_nodes end;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  if v_nodes is not null and exists (select 1 from unnest(v_nodes) x
       where not exists (select 1 from public.course_nodes n where n.id = x and n.class_type_id = p_type)) then
    raise exception 'INVALID_NODE';
  end if;
  insert into public.classes (name, class_type_id, start_date, created_by)
  values (trim(p_name), p_type, p_start, auth.uid()) returning id into cid;
  insert into public.class_sessions (class_id, session_no, content, session_date, shift, counts_absent, teacher_email, node_id)
  select cid, t.session_no, t.content,
         case when t.day_no is null then p_start + (t.session_no - 1) else public.add_workdays(p_start, t.day_no - 1) end,
         t.shift, t.counts_absent, public.my_email(), t.node_id
    from public.class_type_sessions t where t.class_type_id = p_type;
  insert into public.class_students (class_id, student_code, node_ids)
  select cid, s.code, v_nodes from public.students s
   where upper(s.code) = any (select upper(trim(x)) from unnest(coalesce(p_codes, '{}')) x)
  on conflict do nothing;
  update public.classes set graduation_date = coalesce(p_grad, (select max(session_date) from public.class_sessions where class_id = cid)) where id = cid;
  return cid;
end $$;

revoke all on function public.nodes_ok(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.add_class_students(uuid, text[], uuid[]), public.set_student_nodes(uuid, text, uuid[]),
  public.create_class(text, uuid, date, text[], date, uuid[]) from public, anon;
grant execute on function public.add_class_students(uuid, text[], uuid[]), public.set_student_nodes(uuid, text, uuid[]),
  public.create_class(text, uuid, date, text[], date, uuid[]) to authenticated;

-- v46: cap 3 cua LPFC-P (M2): TT, CS, VH, UL, EPOS, ACTIVE tuong ung buoi 9-14
do $$
declare t uuid; m2 uuid; n uuid; i int; codes text[] := array['TT','CS','VH','UL','EPOS','ACTIVE'];
begin
  select id into t from public.class_types where name = 'LPFC-P';
  select id into m2 from public.course_nodes where class_type_id = t and code = 'M2' and parent_id is null;
  if t is null or m2 is null or exists (select 1 from public.course_nodes where parent_id = m2) then return; end if;
  for i in 1..6 loop
    insert into public.course_nodes (class_type_id, parent_id, code, sort_no, max_absent) values (t, m2, codes[i], i, null) returning id into n;
    update public.class_type_sessions set node_id = n where class_type_id = t and session_no = 8 + i;
    update public.class_sessions cs set node_id = n from public.classes c where cs.class_id = c.id and c.class_type_id = t and cs.session_no = 8 + i;
  end loop;
end $$;

-- v50: tìm học viên theo tên/mã phía server (không tải cả kho)
create extension if not exists unaccent with schema extensions;
create or replace function public.search_students(p_q text, p_class uuid default null)
returns table(code text, full_name text, title text, in_class boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
declare k text := lower(extensions.unaccent(trim(coalesce(p_q,''))));
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if length(k) < 2 then return; end if;
  k := replace(replace(replace(k,'\','\\'),'%','\%'),'_','\_');
  return query
    select s.code, s.full_name, s.title,
      (p_class is not null and exists (select 1 from class_students cs where cs.class_id = p_class and cs.student_code = s.code))
    from students s
    where lower(extensions.unaccent(s.full_name)) like '%'||k||'%' or s.code like '%'||k||'%'
    order by s.full_name, s.code
    limit 20;
end $$;
revoke all on function public.search_students(text, uuid) from public, anon;
grant execute on function public.search_students(text, uuid) to authenticated;

-- v53: ngày học viên vào lớp (buổi mở trước ngày này không tính vắng); dòng cũ để null = tính từ đầu
alter table public.class_students add column if not exists added_at timestamptz;
alter table public.class_students alter column added_at set default now();

-- v54: check_in báo "Bạn chưa đăng ký lớp này" + chặn học viên ngoài module của buổi (patch hàm check_in hiện có)
do $$
declare d text; old1 text; new1 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='check_in';
  old1 := E'  if not exists (select 1 from public.class_students where class_id = sess.class_id and student_code = p.student_code) then\n    return jsonb_build_object(''status'', ''not_in_class'', ''message'', ''Bạn không có trong danh sách lớp này'');\n  end if;\n';
  new1 := E'  if not exists (select 1 from public.class_students where class_id = sess.class_id and student_code = p.student_code) then\n    return jsonb_build_object(''status'', ''not_in_class'', ''message'', ''Bạn chưa đăng ký lớp này'');\n  end if;\n  if exists (select 1 from public.class_students cs where cs.class_id = sess.class_id and cs.student_code = p.student_code\n      and cs.node_ids is not null and cardinality(cs.node_ids) > 0\n      and not (sess.node_id is not null and (sess.node_id = any(cs.node_ids)\n           or exists (select 1 from public.course_nodes n where n.id = sess.node_id and n.parent_id = any(cs.node_ids))))) then\n    return jsonb_build_object(''status'', ''not_in_module'', ''message'', ''Bạn không thuộc module này nên không điểm danh được'');\n  end if;\n';
  if position(old1 in d) > 0 then
    d := replace(replace(d, old1, new1), 'c.name as class_name,', 's.node_id, c.name as class_name,');
    execute d;
  end if;
end $$;

-- v56: học viên xem số buổi vắng theo module của chính mình (trang chủ)
create or replace function public.my_absences()
returns jsonb language sql stable security definer set search_path = public as $$
with me as (select student_code from profiles where id = auth.uid() and role = 'student'),
base as (
  select cs.class_id, s.id sid, s.opened_at, s.counts_absent, s.node_id,
    coalesce(p.id, n.id) mod_id, coalesce(p.code, n.code) mod_code, coalesce(p.max_absent, n.max_absent) mod_max,
    ct.max_absent legacy_max,
    exists (select 1 from attendance a where a.session_id = s.id and a.student_code = cs.student_code) att
  from class_students cs
  join me on me.student_code = cs.student_code
  join classes c on c.id = cs.class_id
  join class_types ct on ct.id = c.class_type_id
  join class_sessions s on s.class_id = cs.class_id
  left join course_nodes n on n.id = s.node_id
  left join course_nodes p on p.id = n.parent_id
  where (cs.node_ids is null or cardinality(cs.node_ids) = 0 or s.node_id = any(cs.node_ids) or n.parent_id = any(cs.node_ids))
    and not (cs.added_at is not null and s.opened_at is not null and s.opened_at < cs.added_at
             and not exists (select 1 from attendance a where a.session_id = s.id and a.student_code = cs.student_code))
),
mods as (
  select class_id, coalesce(mod_code, 'Cả khoá') code, coalesce(mod_max, case when mod_id is null then legacy_max else 1 end, case when mod_id is null then null else 1 end) mx,
    count(*) filter (where opened_at is not null and counts_absent is not false and not att) used
  from base group by class_id, mod_id, mod_code, mod_max, legacy_max
)
select coalesce(jsonb_agg(jsonb_build_object('class_id', c.class_id, 'attended', c.att, 'total', c.tot,
  'mods', (select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'used', m.used, 'max', m.mx) order by m.code), '[]'::jsonb) from mods m where m.class_id = c.class_id))), '[]'::jsonb)
from (select class_id, count(*) tot, count(*) filter (where att) att from base group by class_id) c;
$$;
revoke all on function public.my_absences() from public, anon;
grant execute on function public.my_absences() to authenticated;

-- v57: thêm ca Tối cho buổi học
alter table public.class_type_sessions drop constraint if exists class_type_sessions_shift_check;
alter table public.class_type_sessions add constraint class_type_sessions_shift_check check (shift in ('sang','chieu','toi'));
alter table public.class_sessions drop constraint if exists class_sessions_shift_check;
alter table public.class_sessions add constraint class_sessions_shift_check check (shift in ('sang','chieu','toi'));
