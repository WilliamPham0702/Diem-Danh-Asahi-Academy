# Điểm danh Asahi Academy

Web điểm danh bằng QR cho lớp đào tạo. Giảng viên mở mã QR (tự đổi mỗi 10 giây), học viên quét bằng camera trên điện thoại.
Giao diện theo phong cách asahilife.com (Noto Sans, navy #002F72, nền #FAF9FD). Chạy miễn phí: giao diện trên **GitHub Pages**, dữ liệu và đăng nhập trên **Supabase** (gói free).

## Chức năng (đợt 1)

- 3 loại tài khoản: **Admin**, **Giảng viên**, **Học viên**
- Học viên chỉ đăng ký được khi **mã học viên + email** có trong danh sách lớp
- Admin: tạo loại lớp (số buổi, nội dung từng buổi), thêm giảng viên, xóa tài khoản, xuất báo cáo
- Giảng viên: tạo lớp, nhập danh sách học viên từ Excel, mở QR theo từng buổi, điểm danh tay, xuất báo cáo
- Học viên: đăng nhập, đổi mật khẩu, quét QR, xem lịch sử
- QR đổi mỗi 10 giây, ký bằng khóa bí mật trên server. Chụp màn hình gửi cho người khác sẽ bị báo không hợp lệ
- Mỗi học viên điểm danh 1 lần/buổi; khóa 1 thiết bị/tài khoản
- Báo cáo Excel: chi tiết từng buổi (đúng giờ, muộn, vắng) và tổng hợp từng học viên

Logo: hiện dùng chữ "Asahi Life Academy". Muốn dùng logo thật, thay chữ trong `js/app.js` (class `brand`) bằng thẻ `<img>` trỏ tới file logo trong repo.

Chưa có (đợt 2): gửi email hàng loạt, tạo tài khoản học viên hàng loạt.

## Cài đặt (khoảng 15 phút)

### 1. Tạo dự án Supabase
1. Vào https://supabase.com, đăng ký (miễn phí), bấm **New project**.
2. Vào **SQL Editor**, dán toàn bộ nội dung `supabase/schema.sql`, bấm **Run**.
3. Vẫn trong SQL Editor, chạy lệnh sau (đổi email của bạn) để tạo admin đầu tiên:
   ```sql
   insert into public.allowed_staff (email, full_name, role)
   values ('email-cua-ban@gmail.com', 'Họ tên của bạn', 'admin');
   ```
4. Vào **Authentication > Providers > Email**:
   - Tắt **Confirm email** nếu muốn học viên đăng ký dùng được ngay (xem phần Lưu ý bảo mật).
   - Mail mặc định của Supabase chỉ gửi vài email/giờ, nên không dùng để xác nhận cho cả lớp.

### 2. Điền cấu hình
Vào **Project Settings > API**, copy **Project URL** và **anon public key**, dán vào `js/config.js`.
Không dán `service_role key` vào đây.

### 3. Bật GitHub Pages
Repo > **Settings > Pages** > Source: nhánh `main`, thư mục `/ (root)`. Sau vài phút web chạy tại
`https://<tên-tài-khoản>.github.io/Diem-Danh-Asahi-Academy/`.

### 4. Dùng lần đầu
1. Mở web, tab **Đăng ký**, nhập email admin ở bước 1.3 (để trống mã học viên) và đặt mật khẩu.
2. Tab **Loại lớp**: tạo loại lớp (mỗi dòng là một buổi).
3. Tab **Nhân sự**: thêm email giảng viên. Giảng viên tự đăng ký bằng email đó.
4. Giảng viên: **Lớp học > Tạo lớp**, nhập file Excel danh sách học viên (cột: Mã học viên, Tên học viên, Tên cấp quản lý, Chức danh, Email).
5. Học viên đăng ký bằng mã + email trong danh sách, rồi quét QR ở tab **Điểm danh**.

## Cách chống gian lận

- Mã QR có chữ ký và hạn dùng 10 giây (cho dư 5 giây vì mạng chậm). Kiểm tra hoàn toàn trên server.
- Mỗi tài khoản chỉ gắn với 1 thiết bị (lưu khi điểm danh lần đầu). Đổi điện thoại thì giảng viên bấm **Đặt lại thiết bị**.
- Giới hạn: người đang ngồi trong lớp quay video màn hình gửi cho bạn bè ở ngoài vẫn quét kịp trong 10 giây. Giảng viên nên nhìn quanh lớp.

## Lưu ý bảo mật và dữ liệu

- **Dữ liệu cá nhân** (tên, email, cấp quản lý) lưu trên Supabase, ngoài hệ thống công ty. Cần được cấp quản lý/IT đồng ý trước khi dùng dữ liệu thật.
- Nếu **tắt Confirm email**: ai biết đúng mã học viên + email của một học viên chưa đăng ký có thể đăng ký trước họ. Nên ra mật khẩu mặc định, hoặc bật xác nhận email qua dịch vụ SMTP riêng.
- Giảng viên xem được toàn bộ danh sách học viên trong hệ thống, nhưng chỉ quản lý được lớp do mình tạo. Admin quản lý tất cả.
- Gói free của Supabase tạm dừng dự án sau 1 tuần không hoạt động. Vào dashboard bấm **Restore**, dữ liệu vẫn còn.
- Hãy xuất báo cáo Excel định kỳ để lưu bản sao dữ liệu.
