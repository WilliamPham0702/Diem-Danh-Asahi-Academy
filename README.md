# Điểm danh Asahi Academy

Web điểm danh bằng QR cho lớp đào tạo. Giảng viên mở mã QR (tự đổi mỗi 10 giây), học viên quét bằng camera trên điện thoại.
Giao diện theo phong cách asahilife.com (Noto Sans, navy #002F72, nền #FAF9FD).
Chạy miễn phí: giao diện trên **GitHub Pages**, dữ liệu và đăng nhập trên **Supabase** (gói free).

## Chức năng (đợt 1)

- 3 loại tài khoản: **Admin**, **Giảng viên**, **Học viên**
- **Học viên không cần email.** Đăng nhập bằng Mã học viên. Mật khẩu ban đầu = Mã học viên (giữ số 0 đầu, ví dụ `000000089`). Đăng nhập lần đầu bắt buộc đổi mật khẩu.
- Giảng viên/admin bấm **Đặt lại MK**: mật khẩu về lại mã học viên, lần đăng nhập sau phải đổi mật khẩu.
- Tài khoản học viên tự được kích hoạt ở lần đăng nhập đầu tiên, miễn là mã có trong danh sách lớp đã nhập. Không cần bước tạo tài khoản hàng loạt.
- Admin: tạo loại lớp (số buổi, nội dung từng buổi), thêm giảng viên, xóa tài khoản, xuất báo cáo
- Giảng viên: tạo lớp, nhập danh sách học viên từ Excel, mở QR từng buổi, điểm danh tay, xuất báo cáo
- Học viên: đăng nhập, đổi mật khẩu, quét QR, xem lịch sử
- QR đổi mỗi 10 giây, ký bằng khóa bí mật trên server. Chụp màn hình gửi người khác sẽ bị báo không hợp lệ
- Mỗi học viên điểm danh 1 lần/buổi; khóa 1 thiết bị/tài khoản
- Báo cáo Excel: chi tiết từng buổi (đúng giờ, muộn, vắng) và tổng hợp từng học viên

Dữ liệu học viên chỉ gồm: mã, họ tên, cấp quản lý, chức danh. **Không lưu email.**

Logo: hiện dùng chữ "Asahi Life Academy". Muốn dùng logo thật, thay chữ trong `js/app.js` (class `brand`) bằng thẻ `<img>` trỏ tới file logo trong repo.

## Cài đặt (khoảng 15 phút)

### 1. Tạo dự án Supabase
1. Vào https://supabase.com, đăng ký (miễn phí), bấm **New project** (Region: Singapore).
2. Vào **SQL Editor**, dán toàn bộ nội dung `supabase/schema.sql`, bấm **Run**.
3. Chạy lệnh sau (đổi email và đặt mã mời của bạn) để tạo admin đầu tiên:
   ```sql
   insert into public.allowed_staff (email, full_name, role, invite_code)
   values ('email-cua-ban@gmail.com', 'Họ tên của bạn', 'admin', 'DAT-MA-MOI-O-DAY');
   ```
4. Vào **Authentication > Sign In / Providers > Email** và **TẮT "Confirm email"**. Bắt buộc, vì tài khoản học viên dùng email nội bộ không có hộp thư thật nên không xác nhận được.

### 2. Điền cấu hình
Vào **Project Settings > API**, copy **Project URL** và **anon public key**, dán vào `js/config.js`.
Không dán `service_role key` vào đây.

Trong `js/config.js` còn 2 tùy chọn:
- `LOGIN_DOMAIN`: tên miền ghép với mã học viên thành email nội bộ (không có thư nào được gửi). Nếu Supabase báo "email không hợp lệ" khi học viên đăng nhập lần đầu, đổi sang tên miền khác đang có email thật.
- `CODE_LENGTH`: số chữ số của mã học viên (mặc định 9). Excel hay làm mất số 0 đầu nên mã toàn số ngắn hơn sẽ được tự thêm số 0. Đặt `0` để tắt.

### 3. Bật GitHub Pages
Repo > **Settings > Pages** > Source: nhánh `main`, thư mục `/ (root)`. Sau vài phút web chạy tại
`https://<tên-tài-khoản>.github.io/Diem-Danh-Asahi-Academy/`.

### 4. Dùng lần đầu
1. Mở web, tab **GV / Admin đăng ký**: nhập email admin, mã mời ở bước 1.3 và mật khẩu.
2. Tab **Loại lớp**: tạo loại lớp (mỗi dòng là một buổi).
3. Tab **Nhân sự**: thêm email giảng viên, gửi mã mời hiện ở bảng cho họ. Giảng viên tự đăng ký bằng email + mã mời.
4. Giảng viên: **Lớp học > Tạo lớp**, nhập file Excel (cột: Mã học viên, Tên học viên, Tên cấp quản lý, Chức danh). Nên để cột Mã học viên ở định dạng Text.
5. Báo học viên: vào web, nhập Mã học viên, mật khẩu là chính mã đó, rồi đặt mật khẩu mới.

## Cách chống gian lận

- Mã QR có chữ ký và hạn dùng 10 giây (cho dư 5 giây vì mạng chậm). Kiểm tra hoàn toàn trên server.
- Mỗi tài khoản chỉ gắn với 1 thiết bị (lưu khi điểm danh lần đầu). Đổi điện thoại thì giảng viên bấm **Đặt lại thiết bị**.
- Giới hạn: người đang ngồi trong lớp quay video màn hình gửi cho bạn bè ở ngoài vẫn quét kịp trong 10 giây. Giảng viên nên nhìn quanh lớp.

## Lưu ý bảo mật và dữ liệu

- **Mật khẩu mặc định = mã học viên là điểm yếu.** Mã học viên có thể đoán được (số liên tiếp) và nằm trên danh sách. Ai biết mã của một học viên chưa đăng nhập lần đầu có thể đăng nhập thay họ và đặt mật khẩu mới. Hậu quả: người đó điểm danh được thay (vẫn phải có mặt tại lớp để quét QR) và học viên thật bị khóa. Cách giảm rủi ro: nhập danh sách lớp sát ngày học, báo học viên đăng nhập đổi mật khẩu ngay buổi đầu, và giảng viên bấm Đặt lại MK khi có sự cố.
- Giảng viên/admin đăng ký bằng email + **mã mời** do admin cấp, nên người lạ biết email cũng không chiếm được tài khoản.
- Nên bật xác thực 2 lớp cho tài khoản GitHub và Supabase của người quản trị.
- **Dữ liệu cá nhân** (tên, cấp quản lý) lưu trên Supabase, ngoài hệ thống công ty. Cần được cấp quản lý/IT đồng ý trước khi dùng dữ liệu thật.
- Giảng viên xem được toàn bộ danh sách học viên trong hệ thống, nhưng chỉ quản lý được lớp do mình tạo. Admin quản lý tất cả.
- Gói free của Supabase tạm dừng dự án sau 1 tuần không hoạt động. Vào dashboard bấm **Restore**, dữ liệu vẫn còn.
- Hãy xuất báo cáo Excel định kỳ để lưu bản sao dữ liệu.
