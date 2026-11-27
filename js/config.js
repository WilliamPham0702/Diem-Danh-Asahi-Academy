// Dán thông tin dự án Supabase của bạn vào đây (Project Settings > API).
// Hai giá trị SUPABASE_* là công khai, không phải mật khẩu.
// TUYỆT ĐỐI KHÔNG dán "service_role key" vào file này.
window.APP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // Học viên đăng nhập bằng Mã học viên. Phía sau hệ thống ghép thành email nội bộ <mã>@<LOGIN_DOMAIN>.
  // Không có email thật nào được gửi đi. Nếu Supabase báo email không hợp lệ, hãy đổi sang tên miền khác đang có email thật.
  LOGIN_DOMAIN: "asahilife.com",

  // Mã học viên dài bao nhiêu chữ số (ví dụ 000000089 = 9). Excel hay làm mất số 0 ở đầu,
  // nên mã toàn số ngắn hơn sẽ được tự thêm số 0 cho đủ độ dài. Đặt 0 để tắt.
  CODE_LENGTH: 9
};
