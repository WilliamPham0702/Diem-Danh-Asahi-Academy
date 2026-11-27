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
  if not public.can_manage_class(cs.class_id) then raise exception 'FORBIDDEN'; end if;
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

  insert into public.class_sessions (class_id, session_no, content, session_date, shift, counts_absent)
  select cid, t.session_no, t.content,
         case when t.day_no is null then p_start + (t.session_no - 1)
              else public.add_workdays(p_start, t.day_no - 1) end,
         t.shift, t.counts_absent
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
    public.can_manage_class(id)
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
    public.can_manage_class(class_id) or student_code = public.my_student_code()
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
    public.can_manage_class(class_id)
    or exists (select 1 from public.class_students cs
                where cs.class_id = class_sessions.class_id and cs.student_code = public.my_student_code())
  );
drop policy if exists sessions_update on public.class_sessions;
create policy sessions_update on public.class_sessions
  for update to authenticated using (public.can_manage_class(class_id)) with check (public.can_manage_class(class_id));

-- attendance: hoc vien xem cua minh; staff xem/diem danh tay/huy trong lop minh quan ly
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated using (
    student_code = public.my_student_code()
    or exists (select 1 from public.class_sessions s
                where s.id = attendance.session_id and public.can_manage_class(s.class_id))
  );
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated with check (
    source = 'manual'
    and exists (select 1 from public.class_sessions s
                 where s.id = attendance.session_id and public.can_manage_class(s.class_id))
  );
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated using (
    exists (select 1 from public.class_sessions s
             where s.id = attendance.session_id and public.can_manage_class(s.class_id))
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
