/* Điểm danh Asahi Academy - giao diện web (không cần build, chạy thẳng trên GitHub Pages) */
(() => {
  'use strict';

  // ---------------------------------------------------------------- tiện ích
  const CFG = window.APP_CONFIG || {};
  const app = document.getElementById('app');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (d) => (d ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
  const fmtDate = (s) => { if (!s) return ''; const a = String(s).slice(0, 10).split('-'); return a.length === 3 ? a[2] + '/' + a[1] + '/' + a[0].slice(-2) : String(s); };
  const ROLE_LABEL = { admin: 'Admin', teacher: 'Giảng viên', student: 'Học viên' };

  const ERR = {
    FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này',
    SESSION_CLOSED: 'Buổi học đã đóng điểm danh',
    SESSION_NOT_FOUND: 'Không tìm thấy buổi học',
    CANNOT_DELETE_SELF: 'Không thể xóa tài khoản của chính mình',
    OUT_OF_SESSION: 'Đã qua buổi học này, chỉ admin mới mở lại được (Reset QR)',
    NOT_YET: 'Chưa đến giờ mở QR của buổi học này (sáng 8:00, chiều 12:30, tối 18:00)',
    NAME_REQUIRED: 'Vui lòng nhập tên lớp',
    STUDENT_NOT_IN_LIST: 'Mã học viên không có trong danh sách. Hãy liên hệ giảng viên của bạn.',
    INVITE_INVALID: 'Email hoặc mã mời không đúng. Hãy liên hệ admin.',
    CLASS_ENDED: 'Lớp học đã kết thúc, không thể thực hiện thao tác này',
    ONLY_CREATOR_END: 'Chỉ giảng viên tạo lớp hoặc admin mới được kết thúc lớp',
    ONLY_ADMIN_REOPEN: 'Chỉ admin mới mở lại được lớp đã kết thúc',
    QR_OTHER_OPENER: 'Giảng viên đang mở QR ở vị trí khác nên trợ giảng chưa mở được mã này',
    NO_TEACHER: 'Buổi này chưa phân công giảng viên hoặc trợ giảng. Hãy chọn người dạy trong trang lớp',
    INVALID_TA: 'Trợ giảng không hợp lệ. Hãy chọn trợ giảng của lớp trước',
    STUDENT_NOT_FOUND: 'Không tìm thấy học viên',
  };
  function errMsg(e) {
    const m = (e && e.message) || String(e);
    for (const k of Object.keys(ERR)) if (m.includes(k)) return ERR[k];
    if (/Database error saving new user/i.test(m)) return 'Thông tin đăng ký không hợp lệ. Hãy liên hệ giảng viên hoặc admin.';
    if (/Invalid login/i.test(m)) return 'Sai mã học viên/email hoặc mật khẩu';
    if (/already registered/i.test(m)) return 'Thông tin đăng ký không hợp lệ hoặc tài khoản đã tồn tại. Hãy liên hệ admin.';
    if (/Email not confirmed/i.test(m)) return 'Tài khoản chưa được xác nhận. Cần tắt "Confirm email" trong Supabase (xem README)';
    if (/at least 6/i.test(m)) return 'Mật khẩu cần ít nhất 6 ký tự';
    return m;
  }

  // Cửa sổ mở QR theo ca (giờ VN): sáng 8:00-12:00 (tắt tự động 9:00), chiều 12:30-17:30 (13:30), tối 18:00-23:00 (19:00), không ca: cả ngày
  function qrOpenable(s) {
    const now = Date.now();
    if (s.qr_reset_until && now <= new Date(s.qr_reset_until).getTime()) return true;
    if (!s.session_date) return false;
    const d = s.session_date;
    const at = (t) => new Date(d + 'T' + t + '+07:00').getTime();
    const next = new Date(new Date(d + 'T00:00:00+07:00').getTime() + 86400000).getTime();
    const a = s.shift === 'sang' ? at('08:00:00') : s.shift === 'chieu' ? at('12:30:00') : s.shift === 'toi' ? at('18:00:00') : at('00:00:00');
    const b = s.shift === 'sang' ? at('12:00:00') : s.shift === 'chieu' ? at('17:30:00') : s.shift === 'toi' ? at('23:00:00') : next;
    return now >= a && now <= b;
  }
  function qrButtons(s, withClose) {
    if (qrOpenable(s)) return `<a class="btn sm pink" href="#/qr/${s.id}">Mở QR</a>`
      + (withClose && s.opened_at && !s.closed ? ` <button class="btn sm ghost" data-close="${s.id}">Đóng</button>` : '');
    if (me.role === 'admin') return `<button class="btn sm ghost" data-resetqr="${s.id}">Reset QR</button>`;
    return '';
  }
  function bindResetQR(root) {
    $$('[data-resetqr]', root).forEach((b) => { b.onclick = () => busy(b, async () => {
      await q(db.rpc('admin_reset_qr', { p_session: b.dataset.resetqr }));
      toast('Đã reset QR: giảng viên được phân công mở lại được trong buổi hiện tại', 'ok'); render(); }); });
  }

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), type === 'err' ? 6000 : 3000);
  }

  function modal(html, onMount) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box">${html}</div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    if (onMount) onMount(m, close);
    return close;
  }

  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { console.error(e); toast(errMsg(e), 'err'); }
    finally { if (btn) btn.disabled = false; }
  }

  // Lấy toàn bộ dòng (Supabase mặc định chỉ trả 1000 dòng / lần)
  async function fetchAll(make) {
    const out = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await make().range(i, i + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  // Học viên đăng nhập bằng Mã học viên (chuỗi, giữ số 0 ở đầu). Phía sau hệ thống dùng email nội bộ <mã>@<LOGIN_DOMAIN>.
  const LOGIN_DOMAIN = CFG.LOGIN_DOMAIN || 'asahilife.com';
  const CODE_LEN = Number(CFG.CODE_LENGTH == null ? 9 : CFG.CODE_LENGTH);
  function normCode(v) {
    let c = String(v == null ? '' : v).trim().toUpperCase();
    if (CODE_LEN && /^\d+$/.test(c) && c.length < CODE_LEN) c = c.padStart(CODE_LEN, '0');
    return c;
  }
  // Họ tên luôn viết hoa chữ cái đầu mỗi từ, bất kể file tải lên viết thế nào
  function properName(v) {
    return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')
      .replace(/(^|[\s\-'’.])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('vi'));
  }
  const codeToEmail = (code) => code.toLowerCase() + '@' + LOGIN_DOMAIN;

  function deviceId() {
    try {
      let id = localStorage.getItem('dd_device');
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        localStorage.setItem('dd_device', id);
      }
      return id;
    } catch (e) {
      window.__dd = window.__dd || String(Math.random()).slice(2) + Date.now();
      return window.__dd;
    }
  }

  // ---------------------------------------------------------------- trạng thái
  let db = null;
  let me = null;
  let skipPw = false;
  let reminderAt = 0;
  let cleanups = [];
  const addCleanup = (fn) => cleanups.push(fn);
  function runCleanups() {
    const list = cleanups; cleanups = [];
    list.forEach((fn) => { try { fn(); } catch (e) { /* bỏ qua */ } });
  }

  const TABS = {
    student: [['home', 'Trang chủ'], ['scan', 'Điểm danh'], ['history', 'Lịch sử'], ['account', 'Tài khoản']],
    teacher: [['schedule', 'Lịch dạy'], ['classes', 'Lớp học'], ['roster', 'Học viên'], ['reports', 'Báo cáo'], ['account', 'Tài khoản']],
    admin: [['schedule', 'Lịch dạy'], ['classes', 'Lớp học'], ['roster', 'Học viên'], ['reports', 'Báo cáo'], ['types', 'Khoá học'],
      ['staff', 'Nhân sự'], ['account', 'Tài khoản']],
  };
  // Học viên được nâng lên trợ giảng: có thêm tab Lịch dạy
  function tabsOf() {
    const t = TABS[me.role];
    return me.role === 'student' && me.is_ta ? t.slice(0, 3).concat([['schedule', 'Lịch dạy']], t.slice(3)) : t;
  }
  const SUBROUTES = { class: 'classes', session: 'classes' };

  function nav(path) { location.hash = '#/' + path; }

  // ---------------------------------------------------------------- khởi động
  async function boot() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      app.innerHTML = `<div class="auth"><div class="card"><h2>Chưa cấu hình</h2>
        <p>Mở file <b>js/config.js</b> và dán <b>SUPABASE_URL</b>, <b>SUPABASE_ANON_KEY</b> của dự án Supabase.
        Xem hướng dẫn trong README.</p></div></div>`;
      return;
    }
    if (!window.supabase) {
      app.innerHTML = '<div class="auth"><div class="card"><p>Không tải được thư viện. Hãy kiểm tra kết nối mạng.</p></div></div>';
      return;
    }
    db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    db.auth.onAuthStateChange((ev) => {
      if (ev === 'SIGNED_OUT') { me = null; skipPw = false; reminderAt = 0; runCleanups(); viewAuth('login'); }
    });
    window.addEventListener('hashchange', () => { if (me) render(); });
    const { data } = await db.auth.getSession();
    if (data.session) await enter(); else viewAuth('login');
  }

  async function enter() {
    const { data: u } = await db.auth.getUser();
    if (!u || !u.user) { viewAuth('login'); return; }
    const { data, error } = await db.from('profiles').select('*').eq('id', u.user.id).maybeSingle();
    if (error || !data) {
      await db.auth.signOut();
      toast('Tài khoản chưa được cấp quyền. Hãy liên hệ admin.', 'err');
      return;
    }
    me = data;
    me.is_ta = false;
    if (me.role === 'student' && me.student_code) {
      const { data: t } = await db.from('teaching_assistants').select('student_code').eq('student_code', me.student_code).maybeSingle();
      me.is_ta = !!t;
    }
    if (me.must_change_password && !skipPw) { viewForceChange(); return; }
    if (!location.hash || location.hash === '#') nav(tabsOf()[0][0]); else render();
    if (me.role === 'student') checkReminder();
  }

  // ---------------------------------------------------------------- thương hiệu (logo lấy từ asahilife.com)
  const LOGO_URL = 'https://static-prod.asahilife.com/logo/main-logo-secondary.webp?v=1.0.9';
  const SYMBOL_URL = 'https://static-prod.asahilife.com/logo/ASAHI_SYMBOL.svg?v=1.0.9';
  // Logo trắng, dùng trên nền navy. Nếu ảnh không tải được thì hiện chữ thay thế.
  // Xử lý ảnh lỗi (không dùng onerror nội tuyến để bật được chính sách bảo mật CSP)
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    if (t.classList.contains('logo')) { const sp = document.createElement('span'); sp.className = 'logo-fb'; sp.textContent = 'Asahi Life'; t.replaceWith(sp); }
    else if (t.classList.contains('symimg')) t.style.display = 'none';
  }, true);
  function logoHtml(h) {
    return `<img class="logo" src="${LOGO_URL}" alt="Asahi Life" height="${h}">`;
  }
  // Video nền động cho toàn bộ web (video trên asahilife.com). Tạo bằng JS để iPhone chịu tự chạy.
  function initBg() {
    const host = document.getElementById('bgv');
    if (!host || document.getElementById('bgvid')) return;
    const v = document.createElement('video');
    v.id = 'bgvid';
    v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('loop', '');
    v.setAttribute('disablepictureinpicture', '');
    [['looping-av1-h265.mp4', 'video/mp4; codecs="hvc1.1.6.L123.B0"'], ['looping-av1.mp4', 'video/mp4; codecs="av01.0.08M.08"']].forEach(([f, t]) => {
      const so = document.createElement('source'); so.src = `https://static-prod.asahilife.com/videos/${f}?v=1.0.9`; so.type = t; v.appendChild(so);
    });
    host.appendChild(v);
    const go = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    v.addEventListener('canplay', go);
    go();
    ['touchstart', 'click', 'scroll', 'keydown'].forEach((ev) => document.addEventListener(ev, go, { once: true, passive: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
  }
  initBg();
  const CDN = 'https://static-prod.asahilife.com';
  const IMG = (n) => `${CDN}/images-webp/${n}?v=1.0.9`;
  function authHero() {
    return `<div class="auth-hero">
      <div class="auth-logo">${logoHtml(36)}</div>
      <div class="auth-jp">新しい朝がはじまる</div>
            <div class="auth-title">Asahi Academy</div>
      <div class="auth-div"><i></i><img class="symimg" src="${SYMBOL_URL}" alt="" height="28"><i></i></div>
      <div class="auth-sub">Training Delivery</div>
    </div>`;
  }
  // Nền video chuyển động (video trên asahilife.com), có ảnh poster dự phòng
  function bgVideoHtml() {
    return `<div class="bgv"><div class="bgv-poster" style="background-image:url('${IMG('hero-poster.webp')}')"></div>
      <video class="bgv-v" muted autoplay loop playsinline preload="auto" poster="${IMG('hero-poster.webp')}">
        <source src="${CDN}/videos/looping-av1-h265.mp4?v=1.0.9" type='video/mp4; codecs="hvc1.1.6.L123.B0"'>
        <source src="${CDN}/videos/looping-av1.mp4?v=1.0.9" type='video/mp4; codecs="av01.0.08M.08"'>
      </video><div class="bgv-shade"></div></div>`;
  }
  // Mỗi trang một ảnh nền + tiêu đề tiếng Nhật riêng (ảnh lấy từ asahilife.com)
  const PAGE_HERO = {
    home: ['朝', 'Trang chủ', 'Lớp của bạn và các lớp đang mở đăng ký', 'hero-poster.webp', 'center 40%'],
    schedule: ['予定', 'Lịch dạy', 'Các buổi dạy được phân công cho bạn', 'Section%20-%20Welcome%20screen.webp', 'center'],
    classes: ['教室', 'Lớp học', 'Quản lý lớp, buổi học và điểm danh', 'Tea-House-Image.webp', 'center bottom'],
    roster: ['学生', 'Học viên', 'Danh sách học viên và các lớp đã tham gia', '390d3d809a7cb45ac603107d5c810a7294519656.webp', 'center'],
    reports: ['報告', 'Báo cáo', 'Xuất báo cáo điểm danh theo lớp', 'room-poster.webp', 'center 45%'],
    tas: ['助手', 'Trợ giảng', 'Nâng học viên lên trợ giảng, gỡ trợ giảng', 'c9e9b35046980a9f83bf5618ab3f357477d20263.webp', 'center'],
    staff: ['職員', 'Nhân sự', 'Giảng viên và quản trị viên', 'c9e9b35046980a9f83bf5618ab3f357477d20263.webp', 'center'],
    scan: ['出席', 'Điểm danh', 'Quét mã QR của giảng viên để điểm danh', 'room-poster.webp', 'center 60%'],
    history: ['履歴', 'Lịch sử điểm danh', 'Các buổi bạn đã tham gia', '89a85df788bb142a6104330626a97798db15c1d0.webp', 'center'],
    account: ['設定', 'Tài khoản', 'Thông tin và mật khẩu', 'Tea-House-Image.webp', 'center 80%'],
    class: ['教室', 'Chi tiết lớp', 'Các buổi học và học viên', 'Tea-House-Image.webp', 'center bottom'],
    session: ['出席', 'Chi tiết buổi học', 'Danh sách điểm danh của buổi học', 'room-poster.webp', 'center 60%'],
  };
  function pageHero(route) {
    const h = PAGE_HERO[route] || PAGE_HERO.schedule;
    const first = (me.full_name || '').trim().split(/\s+/).slice(-1)[0] || 'bạn';
    return `<section class="phero" style="--hero:url('${IMG(h[3])}');--heropos:${h[4]}"><div class="phero-in">
      <div class="phero-jp">${h[0]}</div>
      <h1>${h[1]}</h1>
      <p>${h[2]} · Xin chào, <b>${esc(first)}</b></p></div></section>`;
  }
  const APP_VERSION = '2026.11.28-62';
  function footerHtml() {
    return `<footer class="foot"><div class="foot-in">${logoHtml(28)}
      <p>Asahi Academy · Training Delivery</p>
      <div class="foot-jp">SINCE 1888</div></div></footer>`;
  }

  // ---------------------------------------------------------------- đăng nhập / đăng ký
  function viewAuth(mode) {
    runCleanups();
    const login = mode === 'login';
    app.innerHTML = `
      <div class="auth">
        ${authHero()}
        <div class="card">
          ${login ? '' : '<h3 style="margin:0 0 6px;text-align:center">Đăng ký tài khoản giảng viên / admin</h3>'}
          <form id="f" autocomplete="on">
            ${login ? `
              <label>Mã học viên</label>
              <input id="id" required autocomplete="username" autocapitalize="characters">
              <label>Mật khẩu</label>
              <input id="pw" type="password" required autocomplete="current-password">` : `
              <label>Email</label><input id="email" type="email" required autocomplete="email">
              <label>Mã mời <span class="muted small">(do admin cung cấp)</span></label>
              <input id="invite" required autocomplete="off">
              <label>Mật khẩu</label><input id="pw" type="password" required minlength="6" autocomplete="new-password">
              <label>Nhập lại mật khẩu</label><input id="pw2" type="password" required minlength="6" autocomplete="new-password">`}
            <div style="margin-top:14px"><button class="btn pink block" id="go">${login ? 'Đăng nhập' : 'Tạo tài khoản'}</button></div>
            <div class="form-msg" id="msg"></div>
          </form>
          ${login
            ? '<p class="small" style="margin:12px 0 0"><a href="#" id="forgot">Quên mật khẩu?</a> &nbsp;·&nbsp; <a href="#" id="signup">Đăng ký tài khoản?</a></p>'
            : '<p class="small" style="margin:12px 0 0"><a href="#" id="back">← Quay lại đăng nhập</a></p>'}
          ${login ? quoteHtml() : ''}
        </div>
      </div>`;
    if (login) {
      $('#forgot').onclick = (e) => { e.preventDefault(); viewForgot(); };
      $('#signup').onclick = (e) => { e.preventDefault(); viewAuth('signup'); };
    } else {
      $('#back').onclick = (e) => { e.preventDefault(); viewAuth('login'); };
    }
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const msg = $('#msg'); msg.className = 'form-msg'; msg.textContent = '';
      const btn = $('#go'); btn.disabled = true;
      try {
        const password = $('#pw').value;
        if (login) {
          const idRaw = $('#id').value.trim();
          const isEmail = idRaw.includes('@');
          const code = isEmail ? '' : normCode(idRaw);
          const email = isEmail ? idRaw : codeToEmail(code);
          const ident = isEmail ? idRaw.toLowerCase() : code;
          const GENERIC = 'Sai mã học viên/email hoặc mật khẩu';
          const lockMsg = (m) => `Tài khoản tạm khóa do nhập sai mật khẩu 5 lần. Thử lại sau ${m} phút, hoặc nhờ giảng viên đặt lại mật khẩu.`;
          const st = await db.rpc('login_status', { p_id: ident });
          if (st.data && st.data.locked) throw new Error(lockMsg(st.data.minutes));
          let { error } = await db.auth.signInWithPassword({ email, password });
          // Mật khẩu mặc định là mã học viên: gõ thiếu số 0 ở đầu thì tự bổ sung rồi thử lại
          if (error && !isEmail && /^\d+$/.test(password.trim()) && normCode(password) !== password) {
            ({ error } = await db.auth.signInWithPassword({ email, password: normCode(password) }));
          }
          // Lần đầu: học viên chưa có tài khoản, mật khẩu = mã học viên -> tự tạo tài khoản mặc định
          if (error && !isEmail && /Invalid login/i.test(error.message) && normCode(password) === code) {
            const r = await db.auth.signUp({ email, password: code, options: { data: { student_code: code } } });
            if (!r.error && r.data.session) error = null;
            else if (!r.error) throw new Error('Chưa đăng nhập được: cần tắt "Confirm email" trong Supabase (xem README).');
          }
          if (error) {
            // Mọi lỗi đăng nhập dùng cùng một thông báo (không để lộ mã nào có trong hệ thống)
            if (/Invalid login/i.test(error.message)) {
              const f = await db.rpc('login_fail', { p_id: ident });
              if (f.data && f.data.locked) throw new Error(lockMsg(f.data.minutes));
              throw new Error(GENERIC + (f.data && f.data.left != null && f.data.left <= 3 ? `. Còn ${f.data.left} lần thử` : ''));
            }
            throw error;
          }
          db.rpc('login_ok').then(() => {}, () => {});
          await enter();
        } else {
          if (password !== $('#pw2').value) throw new Error('Hai mật khẩu không giống nhau');
          const { data, error } = await db.auth.signUp({
            email: $('#email').value.trim(), password, options: { data: { invite_code: $('#invite').value.trim() } },
          });
          if (error) throw error;
          if (data.session) await enter();
          else throw new Error('Chưa đăng nhập được: cần tắt "Confirm email" trong Supabase (xem README).');
        }
      } catch (err) {
        msg.className = 'form-msg err'; msg.textContent = errMsg(err);
      } finally { btn.disabled = false; }
    };
  }

  // Học viên tự đặt lại mật khẩu về mã học viên (không cần đăng nhập)
  function viewForgot() {
    runCleanups();
    app.innerHTML = `
      <div class="auth">
        ${authHero()}
        <div class="card">
          <h2>Quên mật khẩu</h2>
          <p class="muted small">Nhập mã học viên. Mật khẩu sẽ quay về chính mã học viên, sau đó bạn đăng nhập và đặt mật khẩu mới.</p>
          <form id="f">
            <label>Mã học viên</label><input id="code" required autocomplete="off" autocapitalize="characters">
            <div class="row" style="margin-top:14px"><button class="btn pink" id="go">Đặt lại mật khẩu</button>
              <button type="button" class="btn ghost" id="back">Quay lại</button></div>
            <div class="form-msg" id="msg"></div>
          </form>
        </div>
      </div>`;
    $('#back').onclick = () => viewAuth('login');
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const msg = $('#msg'); msg.className = 'form-msg'; msg.textContent = '';
      const btn = $('#go'); btn.disabled = true;
      try {
        const code = normCode($('#code').value);
        const { error } = await db.rpc('reset_password_by_code', { p_code: code });
        if (error) throw error;
        msg.className = 'form-msg okm';
        msg.textContent = 'Nếu mã học viên hợp lệ, mật khẩu đã được đặt lại. Hãy đăng nhập bằng mã học viên, mật khẩu cũng là mã học viên.';
      } catch (err) {
        msg.className = 'form-msg err'; msg.textContent = errMsg(err);
      } finally { btn.disabled = false; }
    };
  }

  // Lần đầu đăng nhập hoặc sau khi bị đặt lại: bắt buộc đổi mật khẩu
  // Đổi mật khẩu: chỉ cần >= 6 ký tự; trùng mật khẩu cũ cũng được
  async function changePassword(p1) {
    if (p1.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự');
    if (me.student_code && normCode(p1) === me.student_code) return; // vẫn là mật khẩu mặc định
    const { error } = await db.auth.updateUser({ password: p1 });
    if (error && !/different from the old/i.test(error.message || '')) throw error;
  }

  function viewForceChange() {
    runCleanups();
    app.innerHTML = `
      <div class="auth">
        ${authHero()}
        <div class="card">
          <h2>Đặt mật khẩu mới</h2>
          <p class="muted small">Xin chào ${esc(me.full_name || '')}. Vì bảo mật, bạn cần đổi mật khẩu trước khi sử dụng (ít nhất 6 ký tự, không cần khác mật khẩu cũ). Nếu đang gấp điểm danh, bạn có thể bấm "Để sau".</p>
          <form id="f">
            <label>Mật khẩu mới</label><input id="p1" type="password" minlength="6" required autocomplete="new-password">
            <label>Nhập lại mật khẩu mới</label><input id="p2" type="password" minlength="6" required autocomplete="new-password">
            <div class="row" style="margin-top:14px"><button class="btn pink" id="go">Đổi mật khẩu</button>
              <button type="button" class="btn ghost" id="later">Để sau</button>
              <button type="button" class="btn ghost" id="out">Thoát</button></div>
            <div class="form-msg" id="msg"></div>
          </form>
        </div>
      </div>`;
    $('#out').onclick = () => db.auth.signOut();
    $('#later').onclick = () => { skipPw = true; location.hash = '#/' + tabsOf()[0][0]; enter(); };
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const msg = $('#msg'); msg.className = 'form-msg'; msg.textContent = '';
      const btn = $('#go'); btn.disabled = true;
      try {
        const p1 = $('#p1').value;
        if (p1 !== $('#p2').value) throw new Error('Hai mật khẩu không giống nhau');
        await changePassword(p1);
        await q(db.rpc('password_changed'));
        toast('Đã đổi mật khẩu', 'ok');
        await enter();
      } catch (err) {
        msg.className = 'form-msg err'; msg.textContent = errMsg(err);
      } finally { btn.disabled = false; }
    };
  }

  // ---------------------------------------------------------------- khung chính
  let renderSeq = 0;
  function render() {
    runCleanups();
    const seq = ++renderSeq;
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    let route = parts[0] || tabsOf()[0][0];
    const param = parts[1];
    const allowed = tabsOf().map((t) => t[0]).concat(me.role === 'student' ? (me.is_ta ? ['qr'] : []) : ['class', 'session', 'qr']);
    if (!allowed.includes(route)) { nav(tabsOf()[0][0]); return; }

    if (route === 'qr') {
      viewQR(param, () => seq !== renderSeq).catch((e) => { console.error(e); toast(errMsg(e), 'err'); });
      return;
    }

    const tabKey = SUBROUTES[route] || route;
    app.innerHTML = `
      <div class="topbar">
        <div class="brand">${logoHtml(26)}</div>
        <div class="who"><span class="name">${esc(me.full_name || me.email)}</span>
          <span class="badge">${ROLE_LABEL[me.role]}${me.is_ta ? ' · Trợ giảng' : ''}</span>
          <button class="btn ghost sm" id="logout">Thoát</button></div>
      </div>
      <div class="tabs">${tabsOf().map(([k, l]) =>
        `<a href="#/${k}" class="${k === tabKey ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${pageHero(route)}
      <main id="main"></main>
      ${footerHtml()}`;
    $('#logout').onclick = () => db.auth.signOut();
    const el = $('#main');
    const views = {
      home: viewHome, scan: viewScan, history: viewHistory, account: viewAccount,
      classes: viewClasses, schedule: viewSchedule, class: viewClass, session: viewSession,
      roster: viewRoster, reports: viewReports, types: viewTypes, staff: viewStaff,
    };
    Promise.resolve(views[route](el, param)).catch((e) => {
      console.error(e);
      el.innerHTML = `<div class="card"><p class="form-msg err">${esc(errMsg(e))}</p></div>`;
    });
  }

  const QUOTES = [
    ['一期一会', 'Ichigo ichie', 'Mỗi cuộc gặp gỡ chỉ có một lần, hãy trân trọng từng buổi học.'],
    ['七転び八起き', 'Nanakorobi yaoki', 'Ngã bảy lần, đứng dậy tám lần.'],
    ['継続は力なり', 'Keizoku wa chikara nari', 'Kiên trì chính là sức mạnh.'],
    ['千里の道も一歩から', 'Senri no michi mo ippo kara', 'Đường ngàn dặm bắt đầu từ một bước chân.'],
    ['為せば成る', 'Naseba naru', 'Có làm thì sẽ thành.'],
    ['日々是好日', 'Nichinichi kore kōjitsu', 'Mỗi ngày đều là một ngày tốt lành.'],
    ['初心忘るべからず', 'Shoshin wasuru bekarazu', 'Đừng quên tâm thế của ngày đầu tiên.'],
    ['石の上にも三年', 'Ishi no ue ni mo sannen', 'Kiên nhẫn đủ lâu, đá cũng thành chỗ ngồi ấm.'],
    ['笑う門には福来る', 'Warau kado ni wa fuku kitaru', 'Nụ cười mở cửa cho may mắn.'],
    ['努力は裏切らない', 'Doryoku wa uragiranai', 'Nỗ lực sẽ không phụ lòng người.'],
    ['塵も積もれば山となる', 'Chiri mo tsumoreba yama to naru', 'Tích tiểu thành đại.'],
    ['急がば回れ', 'Isogaba maware', 'Chậm mà chắc, cẩn thận sẽ đến đích nhanh hơn.'],
    ['おもてなしの心', 'Omotenashi no kokoro', 'Tấm lòng đón tiếp chân thành, không mong đền đáp.'],
    ['心を込めて', 'Kokoro o komete', 'Làm mọi việc bằng cả tấm lòng.'],
    ['笑顔は最高のおもてなし', 'Egao wa saikō no omotenashi', 'Nụ cười là cách đón tiếp đẹp nhất.'],
    ['思いやり', 'Omoiyari', 'Biết nghĩ cho người khác, đó là nền tảng của sự phục vụ.'],
    ['気配り', 'Kikubari', 'Chu đáo, để ý những điều nhỏ nhất vì người đối diện.'],
    ['相手の立場に立って', 'Aite no tachiba ni tatte', 'Đặt mình vào vị trí của người đối diện.'],
    ['誠心誠意', 'Seishin seii', 'Hết lòng, chân thành trong từng việc làm.'],
    ['感謝の気持ち', 'Kansha no kimochi', 'Giữ lòng biết ơn mỗi ngày.'],
    ['三方よし', 'Sanpō yoshi', 'Tốt cho mình, tốt cho khách hàng, tốt cho xã hội.'],
    ['袖振り合うも多生の縁', 'Sode furiau mo tashō no en', 'Chạm vai nhau thoáng qua cũng là duyên.'],
    ['実るほど頭を垂れる稲穂かな', 'Minoru hodo kōbe o tareru inaho kana', 'Lúa càng chín càng cúi đầu: càng giỏi càng khiêm tốn.'],
    ['ありがとうの一言', 'Arigatō no hitokoto', 'Một lời cảm ơn có thể làm ấm cả một ngày.'],
  ];
  function quoteHtml() {
    let i = Math.floor(Math.random() * QUOTES.length);
    try { const last = +sessionStorage.getItem('lastQuote'); if (QUOTES.length > 1 && i === last) i = (i + 1) % QUOTES.length; sessionStorage.setItem('lastQuote', i); } catch (e) {}
    const [jp, ro, vi] = QUOTES[i];
    return `<div class="quote"><div class="qjp">${jp}</div><div class="small muted">${ro}</div><div class="small">${vi}</div></div>`;
  }
  // ================================================================ HỌC VIÊN: nhắc điểm danh
  async function checkReminder() {
    if (!me || me.role !== 'student' || Date.now() - reminderAt < 5 * 60 * 1000) return;
    try {
      const { data } = await db.rpc('my_open_sessions');
      if (!data || !data.length) return;
      reminderAt = Date.now();
      modal(`<h3 style="text-align:center">🔔 Đang có buổi cần điểm danh</h3>
        ${data.map((x) => `<div class="card" style="margin:8px 0"><b>${esc(x.class_name)}</b><br><span class="muted small">Buổi ${esc(x.session_no)}: ${esc(x.content || '')}</span></div>`).join('')}
        <p class="muted small" style="text-align:center">Bấm nút bên dưới để mở camera và quét mã QR trên màn hình giảng viên.</p>
        <div class="row" style="justify-content:center;margin-top:10px"><button class="btn pink" id="goscan">Mở camera điểm danh</button>
          <button class="btn ghost" id="lt">Để sau</button></div>`, (m, close) => {
        $('#lt', m).onclick = close;
        $('#goscan', m).onclick = () => { close(); sessionStorage.setItem('autoscan', '1'); if (location.hash === '#/scan') render(); else nav('scan'); };
      });
    } catch (e) { console.error(e); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me && me.role === 'student') checkReminder(); });

  // ================================================================ HỌC VIÊN: trang chủ
  const WISHES = {
    sang: ['Chúc bạn một buổi sáng như bình minh Nhật Bản: mỗi điều mới học hôm nay là một tia nắng cho sự nghiệp của bạn.',
      'Buổi sáng là trang giấy trắng. Hãy viết lên đó thật nhiều ý tưởng và nụ cười!',
      'Chúc bạn một buổi sáng bứt phá: học một điều, làm một điều, tiến thêm một bước.',
      '新しい朝がはじまる, một buổi sáng mới bắt đầu. Hôm nay bạn sẽ giỏi hơn hôm qua!',
      'Bắt đầu ngày mới bằng một nụ cười. Nụ cười của bạn là cách tiếp đón đẹp nhất dành cho mọi người.',
      'Chúc bạn sáng nay đầu óc minh mẫn, tinh thần phấn khởi và học được thật nhiều điều hay.',
      'Mỗi sáng thức dậy là một cơ hội mới để trở thành phiên bản tốt hơn của chính mình.',
      'Chỉ cần mỗi ngày tiến thêm một chút, bạn sẽ đi rất xa. Chúc bạn một buổi sáng đầy cảm hứng!'],
    chieu: ['Chúc bạn một buổi chiều tràn đầy năng lượng: kiên trì thêm chút nữa, thành quả đang ở rất gần.',
      'Giữa ngày là lúc khẳng định bản lĩnh. Chúc bạn tập trung, vui và thật hiệu quả!',
      'Mỗi buổi học là một viên gạch xây nên phiên bản xuất sắc nhất của bạn. Chúc bạn một buổi chiều thật đáng giá!',
      'Chúc bạn buổi chiều thật nhiều niềm vui học hỏi. Điều bạn học hôm nay sẽ là hành trang cho ngày mai.',
      'Mệt một chút cũng không sao, bạn đang tiến gần hơn đến mục tiêu của mình rồi. Cố lên nhé!',
      'Một buổi chiều chăm chỉ hôm nay là nền móng cho thành công của những ngày sau.',
      'Chúc bạn giữ vững tinh thần, lắng nghe, đặt câu hỏi và mang về thật nhiều giá trị.'],
    toi: ['Chúc bạn một buổi tối bình yên, nhìn lại những gì đã học và tự hào về bản thân nhé.',
      'Ngày hôm nay bạn đã cố gắng rất nhiều. Chúc bạn một buổi tối thật nhẹ nhõm và một giấc ngủ ngon!',
      'Sau mỗi ngày nỗ lực là một buổi tối xứng đáng nghỉ ngơi. Chúc bạn tối nay thật ấm áp!',
      'Chúc bạn buổi tối học tập hiệu quả. Kiến thức hôm nay sẽ trở thành tự tin của ngày mai.',
      'Đèn sáng ở đâu, nơi đó có người đang cố gắng. Bạn thật đáng khâm phục, chúc bạn một buổi tối tốt lành!',
      'Cảm ơn bạn đã dành thời gian cho việc học. Chúc bạn một buổi tối vui và thật nhiều năng lượng.',
      'Mỗi buổi tối học thêm một chút là bạn đã vượt qua chính mình của hôm qua.'],
  };
  // Xoay vòng: xáo trộn rồi lấy lần lượt, hết vòng mới xáo lại; không lặp câu vừa dùng
  function wishNow() {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours();
    const part = h < 12 ? 'sang' : h < 18 ? 'chieu' : 'toi';
    const word = { sang: 'buổi sáng', chieu: 'buổi chiều', toi: 'buổi tối' }[part];
    const list = WISHES[part];
    let bag = [], last = -1;
    try { bag = JSON.parse(localStorage.getItem('wb_' + part) || '[]').filter((i) => i < list.length); last = +localStorage.getItem('wl_' + part); } catch (e) { bag = []; }
    if (!bag.length) {
      bag = list.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    const i = bag.pop();
    try { localStorage.setItem('wb_' + part, JSON.stringify(bag)); localStorage.setItem('wl_' + part, String(i)); } catch (e) { /* bỏ qua */ }
    return { word, text: list[i] };
  }
  async function viewHome(el) {
    const w = wishNow();
    el.innerHTML = `
      <div class="welcome2">
        <div class="w-kanji">歓迎</div>
        <div class="w-hello">Chào mừng</div>
        <div class="w-name">${esc(me.full_name || 'bạn')}</div>
        <div class="w-to">đã đến với <b>Asahi Academy</b></div>
        <div class="w-wish">${esc(w.text)}</div></div>
      <div id="cl" class="muted center">Đang tải lớp học...</div>`;
    const box = $('#cl', el);
    const rows = await q(db.rpc('list_open_classes'));
    const myAbs = {}; try { (await q(db.rpc('my_absences'))).forEach((x) => { myAbs[x.class_id] = x; }); } catch (e) { /* chưa có thì bỏ qua */ }
    if (!box || !box.isConnected) return;
    const fmtRange = (c) => c.first_session ? `${fmtDate(c.first_session)} → ${fmtDate(c.last_session)}` : '(chưa có lịch)';
    const group = (list) => {
      const g = {}; list.forEach((c) => { (g[c.type_name] = g[c.type_name] || []).push(c); });
      return Object.keys(g).sort((a, b) => a.localeCompare(b, 'vi')).map((k) => [k, g[k]]);
    };
    const joined = rows.filter((c) => c.joined);
    const open = rows.filter((c) => !c.joined);
    const card = (c, isOpen) => {
      const ab = myAbs[c.id]; const att = ab ? ab.attended : c.attended; const tot = ab ? ab.total : c.total_sessions;
      const pct = tot ? Math.round(100 * att / tot) : 0;
      const mods = ab ? ab.mods.filter((m) => m.max != null) : [];
      const over = mods.filter((m) => m.used > m.max), full = mods.filter((m) => m.used >= 1 && m.used === m.max);
      const warn = over.length ? `<div class="abs-warn bad">⚠ Bạn đã vắng quá số buổi cho phép: ${over.map((m) => esc(m.code) + ' ' + m.used + '/' + m.max).join(', ')}. Hãy liên hệ giảng viên.</div>`
        : full.length ? `<div class="abs-warn warn">Bạn đã dùng hết số buổi được vắng: ${full.map((m) => esc(m.code) + ' ' + m.used + '/' + m.max).join(', ')}. Vắng thêm sẽ bị vượt.</div>` : '';
      const absLine = mods.length ? `<div class="small" style="margin-top:4px">Vắng: ${mods.map((m) => `<span class="badge ${m.used > m.max ? 'bad' : m.used >= 1 && m.used === m.max ? 'warn' : 'gray'}">${esc(m.code)} ${m.used}/${m.max}</span>`).join(' ')}</div>` : '';
      return `<div class="ccard ${isOpen ? '' : 'go'}" ${isOpen ? '' : `data-go="1" role="button" tabindex="0"`}>
      <div class="cc-top"><span class="cc-name">${esc(c.name)}</span>${isOpen ? '' : c.ended ? '<span class="badge gray">Đã kết thúc</span>' : '<span class="badge ok">Đã tham gia</span>'}</div>
      <div class="cc-meta"><div><span>Thời gian</span>${esc(fmtRange(c))}</div>
        ${c.location ? `<div><span>Địa điểm</span>${esc(c.location)}</div>` : ''}
        ${(c.teachers || []).length ? `<div><span>Giảng viên</span>${esc(c.teachers.join(', '))}</div>` : ''}</div>
      ${isOpen ? `<button class="btn pink" data-reg="${c.id}" style="width:100%;margin-top:10px">Đăng ký lớp này</button>`
        : `<div class="cc-prog"><div class="bar"><i style="width:${pct}%"></i></div><div class="small">Đã điểm danh <b>${att}/${tot}</b> buổi · <u>Bấm để điểm danh</u></div>${absLine}${warn}</div>`}
    </div>`;
    };
    const section = (title, list, isOpen, empty) => `<div class="card"><h3>${title}</h3>${list.length ? group(list).map(([k, items]) =>
      `<div class="cl-type">${esc(k)}</div>${items.map((c) => card(c, isOpen)).join('')}`).join('') : `<p class="muted">${empty}</p>`}</div>`;
    box.outerHTML = section('Lớp học của bạn', joined, false, 'Bạn chưa tham gia lớp nào.')
      + section('Lớp đang mở đăng ký', open, true, 'Hiện chưa có lớp nào mở đăng ký.');
    $$('.ccard.go', el).forEach((d) => { d.onclick = () => nav('scan'); });
    $$('[data-reg]', el).forEach((b) => { b.onclick = () => {
      const c = rows.find((x) => x.id === b.dataset.reg);
      modal(`<h3 style="text-align:center">Đăng ký lớp</h3>
        <div class="card" style="margin:8px 0"><b>${esc(c.name)}</b>
          <div class="small" style="margin-top:6px">Khoá học: ${esc(c.type_name)}<br>Thời gian học: ${esc(fmtRange(c))}<br>Địa điểm: ${esc(c.location || '(chưa cập nhật)')}<br>Giảng viên: ${esc((c.teachers || []).join(', ') || '(chưa phân công)')}</div></div>
        <p class="muted small">Mỗi buổi học chỉ được tham gia 1 lớp. Nếu trùng ngày và ca với lớp bạn đang học, hệ thống sẽ báo.</p>
        <div class="row" style="justify-content:center;margin-top:10px"><button class="btn pink" id="okreg">Xác nhận đăng ký</button>
          <button class="btn ghost" id="noreg">Hủy</button></div>`, (m, close) => {
        $('#noreg', m).onclick = close;
        $('#okreg', m).onclick = () => busy($('#okreg', m), async () => {
          const r = await q(db.rpc('enroll_class', { p_class: c.id }));
          close();
          toast(r.message, r.status === 'ok' ? 'ok' : 'err');
          if (r.status === 'ok') render();
        });
      });
    }; });
  }

  // ================================================================ HỌC VIÊN
  function viewScan(el) {
    el.innerHTML = `
      <div class="card center">
        <h2>Quét mã QR điểm danh</h2>
        <p class="muted">Mã QR trên màn hình giảng viên đổi mỗi 10 giây. Hãy quét trực tiếp, không chụp lại hình.</p>
        <div id="reader"></div>
        <div id="result"></div>
        <button class="btn pink" id="start">Mở camera</button>
      </div>`;
    let scanner = null;
    let handling = false;
    async function stop() {
      if (!scanner) return;
      const s = scanner; scanner = null;
      try { await s.stop(); } catch (e) { /* đã dừng */ }
      try { s.clear(); } catch (e) { /* đã xóa */ }
    }
    addCleanup(stop);

    // Vị trí: xin quyền một lần, ghi lại để giảng viên xem. Không cho phép vẫn điểm danh được (bị ghi "ngoài khu vực").
    let pos = null; let watchId = null;
    if (navigator.geolocation) {
      try {
        watchId = navigator.geolocation.watchPosition((p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; },
          () => { /* từ chối hoặc không lấy được: bỏ qua */ }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
      } catch (e) { /* bỏ qua */ }
      addCleanup(() => { if (watchId != null) navigator.geolocation.clearWatch(watchId); });
    }

    function showResult(r) {
      const cls = { ok: 'ok', already: 'info', closed: 'warn', device_mismatch: 'warn', device_used: 'warn' }[r.status] || 'bad';
      const title = { ok: r.late ? 'Đã điểm danh (đến muộn)' : 'Điểm danh thành công', already: 'Đã điểm danh' }[r.status] || 'Chưa điểm danh được';
      let extra = '';
      if (r.status === 'ok') {
        extra = `<p class="small">Lớp: <b>${esc(r.class_name)}</b><br>Buổi ${esc(r.session_no)}: ${esc(r.content || '')}<br>
          Học viên: <b>${esc(r.student_name)}</b> (${esc(r.student_code)})<br>Thời gian: <b>${esc(fmtTime(r.checked_at))}</b></p>`
          + (r.out_of_area ? '<p class="small muted">Vị trí của bạn ngoài khu vực lớp hoặc chưa được cho phép. Hệ thống đã ghi nhận để giảng viên xem.</p>' : '');
      }
      $('#result').innerHTML = `<div class="result ${cls}"><h3>${title}</h3><div>${esc(r.status === 'ok' ? '' : r.message)}</div>${extra}</div>`;
      $('#start').textContent = r.status === 'ok' ? 'Quét buổi khác' : 'Quét lại';
      $('#start').classList.remove('hide');
    }

    async function submit(token) {
      $('#result').innerHTML = '<p class="muted">Đang ghi nhận...</p>';
      const { data, error } = await db.rpc('check_in', { p_token: token, p_device: deviceId(), p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null, p_acc: pos ? pos.acc : null });
      if (error) { showResult({ status: 'error', message: errMsg(error) }); return; }
      showResult(data);
    }

    $('#start').onclick = async () => {
      $('#result').innerHTML = '';
      await stop();
      scanner = new Html5Qrcode('reader');
      handling = false;
      try {
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
          async (text) => {
            if (handling) return;
            handling = true;
            await stop();
            await submit(text);
          });
        $('#start').classList.add('hide');
      } catch (e) {
        console.error(e);
        scanner = null;
        $('#result').innerHTML = `<div class="result bad">Không mở được camera. Hãy cho phép quyền camera cho trình duyệt
          (trang phải mở bằng https).</div>`;
      }
    };
    if (sessionStorage.getItem('autoscan')) { sessionStorage.removeItem('autoscan'); setTimeout(() => { const b = $('#start'); if (b) b.click(); }, 300); }
  }

  async function viewHistory(el) {
    el.innerHTML = '<div class="card"><h2>Lịch sử điểm danh</h2><div id="t" class="muted">Đang tải...</div></div>';
    const rows = await q(db.from('attendance')
      .select('checked_at, source, class_sessions(session_no, content, classes(name))')
      .order('checked_at', { ascending: false }).limit(200));
    $('#t').outerHTML = rows.length ? `<div class="tbl-wrap"><table>
      <tr><th>Thời gian</th><th>Lớp</th><th>Buổi</th><th>Nội dung</th></tr>
      ${rows.map((r) => `<tr><td>${esc(fmtTime(r.checked_at))}</td>
        <td>${esc(r.class_sessions?.classes?.name)}</td>
        <td>${esc(r.class_sessions?.session_no)}</td>
        <td>${esc(r.class_sessions?.content)}</td></tr>`).join('')}</table></div>`
      : '<p class="muted">Chưa có buổi nào được điểm danh.</p>';
  }

  // ================================================================ TÀI KHOẢN (chung)
  function viewAccount(el) {
    el.innerHTML = `
      <div class="card">
        <h2>Tài khoản</h2>
        <div class="muted small" style="float:right">Phiên bản ${APP_VERSION}</div>
        <p>${esc(me.full_name || '')}${me.student_code ? `<br>Mã học viên: <b>${esc(me.student_code)}</b>` : `<br><span class="muted">${esc(me.email)}</span>`}</p>
      </div>
      <div class="card" style="max-width:440px;margin-left:auto;margin-right:auto">
        <h3 style="text-align:center">Đổi mật khẩu</h3>
        <form id="f">
          <label>Mật khẩu mới</label><input id="p1" type="password" minlength="6" required autocomplete="new-password">
          <label>Nhập lại mật khẩu mới</label><input id="p2" type="password" minlength="6" required autocomplete="new-password">
          <div style="margin-top:12px"><button class="btn">Đổi mật khẩu</button></div>
        </form>
      </div>`;
    $('#f').onsubmit = (e) => {
      e.preventDefault();
      busy($('#f button'), async () => {
        if ($('#p1').value !== $('#p2').value) throw new Error('Hai mật khẩu không giống nhau');
        await changePassword($('#p1').value);
        await q(db.rpc('password_changed'));
        $('#f').reset();
        toast('Đã đổi mật khẩu', 'ok');
      });
    };
  }

  // ================================================================ EXCEL: nhập danh sách học viên
  const norm = (s) => String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  function mapRow(row, hoso) {
    const out = { code: '', full_name: '', title: '' };
    for (const key of Object.keys(row)) {
      const k = norm(key); const v = String(row[key] ?? '').trim();
      if (!v) continue;
      if (k.includes('email') || k.includes('mail')) continue; // không lưu email
      else if (k.includes('quanly') || k.includes('manager')) continue; // không lưu cấp quản lý (kể cả cột gộp "cấp quản lý và chức danh")
      else if (k.includes('chucdanh') || k.includes('chucvu') || k === 'title') { if (!hoso) out.title = v; } // file hồ sơ lớp: chỉ lấy mã + họ tên
      else if (['mahocvien', 'mahv', 'mshv', 'masotam', 'maso', 'ma', 'code'].includes(k) || k.includes('mahocvien')) out.code = normCode(v);
      else if (k.includes('tenhocvien') || k.includes('hoten') || k.includes('hovaten') || k === 'ten' || k === 'name' || k === 'fullname') out.full_name = properName(v);
    }
    return out;
  }

  // Nhận cả file mẫu của mình lẫn file "Hồ sơ lớp" nhiều sheet (lấy sheet DS HOC VIEN: Mã số tạm + Họ và tên)
  const isCodeHead = (k) => k.includes('mahocvien') || k === 'mahv' || k === 'mshv' || k === 'masotam' || k === 'maso';
  const isNameHead = (k) => k.includes('hoten') || k.includes('hovaten') || k.includes('tenhocvien');
  const findHeadRow = (grid) => grid.findIndex((row, i) => i < 20 && row.some((c) => isCodeHead(norm(String(c)))) && row.some((c) => isNameHead(norm(String(c)))));
  async function readStudentsFile(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const pref = (n) => { const k = norm(n); return k.includes('dshocvien') || k.includes('danhsachhocvien') ? 0 : k.includes('hocvien') ? 1 : 2; };
    const names = wb.SheetNames.slice().sort((x, y) => pref(x) - pref(y));
    let grid = null; let hi = -1;
    for (const n of names) { const g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }); const h = findHeadRow(g); if (h >= 0) { grid = g; hi = h; break; } }
    if (!grid) grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
    if (hi < 0) hi = 0;
    const hoso = (grid[hi] || []).some((c) => norm(String(c)) === 'masotam');
    const heads = (grid[hi] || []).map((h) => String(h).trim());
    const rows = grid.slice(hi + 1).map((arr) => { const o = {}; heads.forEach((h, j) => { if (h) o[h] = arr[j] ?? ''; }); return o; });
    const seen = new Set(); const ok = []; const bad = []; let skipped = 0;
    rows.forEach((r, i) => {
      if (!Object.values(r).some((v) => String(v).trim())) return; // dòng trống
      const s = mapRow(r, hoso);
      if (!s.code || !s.full_name) { bad.push(i + hi + 2); return; }
      if (seen.has(s.code)) { skipped++; return; }
      seen.add(s.code); ok.push(s);
    });
    // File lỗi thì không cho tiếp tục (không tạo lớp, không nhập)
    if (!ok.length) throw new Error('File không có học viên hợp lệ. Cần các cột "Mã học viên" và "Họ và tên" (dòng đầu là tiêu đề cột).');
    if (bad.length) throw new Error(`File lỗi: dòng ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? '...' : ''} thiếu mã học viên hoặc họ tên. Hãy sửa file rồi tải lại.`);
    return { rows: ok, skipped, hoso };
  }

  async function importStudents(file) {
    const { rows, skipped } = await readStudentsFile(file);
    const st = await addToStore(rows);
    return { codes: st.codes, count: rows.length, skipped, added: st.added, existed: st.existed };
  }

  function parseCodes(text) {
    return String(text || '').split(/[\s,;]+/).map(normCode).filter(Boolean);
  }

  async function missingCodes(codes) {
    const found = new Set();
    for (let i = 0; i < codes.length; i += 100) {
      const data = await q(db.from('students').select('code').in('code', codes.slice(i, i + 100)));
      data.forEach((d) => found.add(d.code));
    }
    return codes.filter((c) => !found.has(c));
  }

  async function downloadTemplate() {
    try {
      await saveXlsx('Mau_danh_sach_hoc_vien.xlsx', [{
        name: 'Danh sách', title: 'Danh sách học viên', nosign: true,
        info: [['Hướng dẫn', 'Điền từ dòng bên dưới tiêu đề cột. Mã học viên giữ nguyên số 0 ở đầu. Không xóa dòng tiêu đề cột màu xanh.'],
          ['Bắt buộc', 'Mã học viên và Họ và tên. Chức danh có thể để trống.']],
        cols: [{ header: 'Mã học viên', key: 'code', width: 18, align: 'center', text: true }, { header: 'Họ và tên', key: 'name', width: 34 }, { header: 'Chức danh', key: 'title', width: 28 }],
        rows: [{ code: '000000089', name: 'Nguyễn Văn A', title: 'Agency Leader' }],
      }]);
    } catch (e) { toast(e.message || 'Không tạo được file mẫu', 'err'); }
  }

  // ================================================================ GIẢNG VIÊN: danh sách lớp
  async function viewClasses(el) {
    el.innerHTML = '<div class="card"><div class="row between"><h2>Lớp học</h2><button class="btn pink" id="new">+ Tạo lớp</button></div><div id="t" class="muted">Đang tải...</div></div>';
    $('#new').onclick = openCreateClass;
    const rows = await q(db.from('classes')
      .select('id, name, start_date, graduation_date, class_types(name), class_students(count), class_sessions(count)')
      .order('created_at', { ascending: false }));
    $('#t').outerHTML = rows.length ? `<div class="tbl-wrap"><table>
      <tr><th>Tên lớp</th><th>Khoá học</th><th>Ngày bắt đầu</th><th>Ngày tốt nghiệp</th><th>Học viên</th><th>Số buổi</th><th></th></tr>
      ${rows.map((c) => `<tr class="rowlink" data-open="${c.id}"><td><a href="#/class/${c.id}"><b>${esc(c.name)}</b></a></td><td>${esc(c.class_types?.name || '')}</td>
        <td>${esc(fmtDate(c.start_date))}</td><td>${esc(fmtDate(c.graduation_date))}</td><td>${c.class_students?.[0]?.count ?? 0}</td>
        <td>${c.class_sessions?.[0]?.count ?? 0}</td>
        <td class="act"><a class="btn sm" href="#/class/${c.id}">Mở lớp</a></td></tr>`).join('')}</table></div>`
      : '<p class="muted">Chưa có lớp nào. Bấm "Tạo lớp" để bắt đầu.</p>';
    $$('[data-open]', el).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a')) nav('class/' + tr.dataset.open); }; });
  }

  // ---- Khoá học > Module (cấp 2) > Nhóm (cấp 3)
  const loadNodes = () => q(db.from('course_nodes').select('id, class_type_id, parent_id, code, sort_no, max_absent').order('sort_no'));
  function nodeCode(courseName, n, all) {
    const p = n.parent_id ? all.find((x) => x.id === n.parent_id) : null;
    return [courseName, p && p.code, n.code].filter(Boolean).join('-');
  }
  // học viên thuộc nodeIds (null = tất cả) có học buổi thuộc node này không
  function inNodes(nodeIds, nodeId, courseNodes) {
    if (!nodeIds || !nodeIds.length) return true;
    if (!nodeId) return false;
    const n = courseNodes.find((x) => x.id === nodeId);
    return nodeIds.includes(nodeId) || !!(n && n.parent_id && nodeIds.includes(n.parent_id));
  }
  const rangeText = (nums) => { const a = nums.slice().sort((x, y) => x - y); const out = []; let i = 0;
    while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`); i = j + 1; } return out.join(', '); };
  function sessionSummary(nodeIds, sessions, courseNodes) {
    const mine = sessions.filter((x) => inNodes(nodeIds, x.node_id, courseNodes));
    const free = mine.filter((x) => x.counts_absent === false);
    if (!mine.length) return 'Chưa có buổi nào thuộc lựa chọn này';
    return `Học <b>${mine.length}</b> buổi (buổi ${rangeText(mine.map((x) => x.session_no))})` + (free.length ? `, trong đó ${free.length} buổi không tính vắng (buổi ${rangeText(free.map((x) => x.session_no))})` : '');
  }
  // Ba ô chọn nối tiếp: cấp 1 (khoá, cố định) -> cấp 2 (module) -> cấp 3 (nhóm). "Tất cả" ở trên đầu mỗi ô.
  function renderNodePicker(m, courseNodes, courseName, sessions) {
    const box = $('#npbox', m); if (!box) return; box._nodes = courseNodes;
    const l2 = courseNodes.filter((n) => !n.parent_id);
    if (!l2.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="cform"><div><label>Cấp 1: khoá học</label><select id="np1" disabled><option>${esc(courseName || '')}</option></select></div>
      <div><label>Cấp 2: module</label><select id="np2"><option value="">Tất cả</option>${l2.map((n) => `<option value="${n.id}">${esc((courseName || '') + '-' + n.code)}</option>`).join('')}</select></div>
      <div class="f-full"><label>Cấp 3: nhóm</label><select id="np3" disabled><option value="">Tất cả</option></select></div></div>
      <div class="small muted">Chọn M1 = học từ M1 đến hết khoá (gồm cả M2). Chọn M2 = chỉ học M2, các buổi M1 sẽ xám.</div>
      <div class="small npsum" id="npsum"></div>`;
    const sum = () => { $('#npsum', m).innerHTML = sessionSummary(nodePickerValue(m), sessions || [], courseNodes); };
    $('#np2', m).onchange = () => {
      const par = l2.find((n) => n.id === $('#np2', m).value);
      const kids = par ? courseNodes.filter((n) => n.parent_id === par.id) : [];
      $('#np3', m).innerHTML = '<option value="">Tất cả</option>' + kids.map((n) => `<option value="${n.id}">${esc((courseName || '') + '-' + par.code + '-' + n.code)}</option>`).join('');
      $('#np3', m).disabled = !kids.length; sum();
    };
    $('#np3', m).onchange = sum; sum();
  }
  // Cấp 2 = học từ module đó đến hết khoá (M1 gồm cả M2; M2 chỉ M2). Cấp 3 chọn cụ thể = chỉ nhóm đó.
  function nodePickerValue(m) {
    const a = $('#np2', m); if (!a || !a.value) return null;
    const b = $('#np3', m);
    if (b && b.value) return [b.value];
    const nodes = ($('#npbox', m) || {})._nodes || [];
    const l2 = nodes.filter((n) => !n.parent_id).sort((x, y) => (x.sort_no || 0) - (y.sort_no || 0));
    const cur = l2.find((n) => n.id === a.value);
    if (!cur) return [a.value];
    const ids = l2.filter((n) => (n.sort_no || 0) >= (cur.sort_no || 0)).map((n) => n.id);
    return ids.length === l2.length ? null : ids;
  }
  // Thêm vào kho học viên: mã đã có thì giữ nguyên, chưa có thì thêm mới, không trùng
  async function addToStore(rows) {
    const uniq = {}; rows.forEach((r) => { if (r.code && !uniq[r.code]) uniq[r.code] = r; });
    const list = Object.values(uniq); const have = new Set();
    for (let i = 0; i < list.length; i += 100) {
      (await q(db.from('students').select('code').in('code', list.slice(i, i + 100).map((r) => r.code)))).forEach((d) => have.add(d.code));
    }
    const fresh = list.filter((r) => !have.has(r.code));
    for (let i = 0; i < fresh.length; i += 400) {
      const { error } = await db.from('students').upsert(fresh.slice(i, i + 400), { onConflict: 'code', ignoreDuplicates: true });
      if (error) throw error;
    }
    return { codes: list.map((r) => r.code), added: fresh.length, existed: list.length - fresh.length };
  }
  // Mô tả module của 1 học viên: danh sách mã ngắn (M1, M2-TT) hoặc "Tất cả module"
  function nodeTags(nodeIds, courseNodes) {
    if (!courseNodes.length) return '';
    if (!nodeIds || !nodeIds.length) return '<span class="badge gray">Tất cả module</span>';
    return nodeIds.map((id) => {
      const n = courseNodes.find((x) => x.id === id); if (!n) return '';
      const par = n.parent_id ? courseNodes.find((x) => x.id === n.parent_id) : null;
      return `<span class="badge">${esc((par ? par.code + '-' : '') + n.code)}</span>`;
    }).join(' ');
  }
  function editStudentNodes(classId, code, name, nodeIds, courseNodes, done) {
    const l2 = courseNodes.filter((n) => !n.parent_id);
    const has = (id) => nodeIds && nodeIds.includes(id);
    modal(`<h3>Module của học viên</h3><p><b>${esc(name)}</b> <span class="small muted">${esc(code)}</span></p>
      <label class="pk"><input type="checkbox" id="nall"${!nodeIds || !nodeIds.length ? ' checked' : ''}><span><b>Học tất cả module</b></span></label>
      <div class="pick" style="max-height:280px">${l2.map((n) => {
        const kids = courseNodes.filter((k) => k.parent_id === n.id);
        return `<label class="pk"><input type="checkbox" data-n="${n.id}"${has(n.id) ? ' checked' : ''}><span><b>${esc(n.code)}</b></span></label>`
          + kids.map((k) => `<label class="pk" style="padding-left:32px"><input type="checkbox" data-n="${k.id}" data-p="${n.id}"${has(k.id) ? ' checked' : ''}><span>${esc(n.code + '-' + k.code)}</span></label>`).join('');
      }).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn pink" id="nok">Lưu</button><button class="btn ghost" id="ncx" type="button">Hủy</button></div>`, (m, close) => {
      $('#ncx', m).onclick = close;
      $$('[data-n]', m).forEach((c) => { c.onchange = () => { if (c.checked) $('#nall', m).checked = false; }; });
      $('#nall', m).onchange = () => { if ($('#nall', m).checked) $$('[data-n]', m).forEach((c) => { c.checked = false; }); };
      $('#nok', m).onclick = () => busy($('#nok', m), async () => {
        let ids = $('#nall', m).checked ? null : $$('[data-n]', m).filter((c) => c.checked).map((c) => c.dataset.n);
        if (ids) ids = ids.filter((id) => { const n = courseNodes.find((x) => x.id === id); return !(n && n.parent_id && ids.includes(n.parent_id)); });
        if (ids && !ids.length) throw new Error('Chọn ít nhất 1 module, hoặc chọn "Học tất cả module"');
        await q(db.rpc('set_student_nodes', { p_class: classId, p_code: code, p_nodes: ids }));
        close(); toast('Đã cập nhật module', 'ok'); done();
      });
    });
  }

  async function openCreateClass() {
    const types = await q(db.from('class_types').select('id, name, class_type_sessions(count)').order('name'));
    const sessList = await q(db.from('class_type_sessions').select('class_type_id, day_no, session_no, node_id, counts_absent'));
    if (!types.length) { toast('Chưa có khoá học nào. Admin cần tạo khoá học trước.', 'err'); return; }
    const allNodes = await loadNodes();
    const today = new Date().toISOString().slice(0, 10);
    modal(`<h2>Tạo lớp</h2>
      <form id="cf">
        <label>Tên lớp</label><input id="cn" required placeholder="VD: LPFC-HCM-20261201" style="text-transform:uppercase" autocapitalize="characters">
        <div class="grid2">
          <div><label>Khoá học</label><select id="ct">${types.map((t) =>
            `<option value="${t.id}">${esc(t.name)} (${t.class_type_sessions?.[0]?.count ?? 0} buổi)</option>`).join('')}</select></div>
          <div><label>Ngày học đầu tiên</label><input id="cd" type="date" value="${today}" required></div>
        </div>
        <div id="npbox"></div>
        <label>Ngày tốt nghiệp <span class="muted small">(tự tính, có thể chọn ngày khác)</span></label><input id="cg" type="date" required>
        <label>Địa điểm học</label><input id="cl" placeholder="VD: Phòng 301, Asahi Life - 123 Nguyễn Huệ, Q.1">
        <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="ce" style="width:auto"> Mở đăng ký cho học viên tự đăng ký lớp này</label>
        <label>Danh sách học viên (file Excel)</label><input id="cx" type="file" accept=".xlsx,.xls,.csv">
        <div class="small muted">Cột: Mã học viên, Họ và tên, Chức danh. Cột Mã học viên nên để định dạng Text để giữ số 0 ở đầu. <a href="#" id="tpl">Tải file mẫu</a></div>
        <div class="row" style="margin-top:14px"><button class="btn pink" id="ok">Tạo lớp</button>
          <button type="button" class="btn ghost" id="cancel">Hủy</button></div>
      </form>`, (m, close) => {
      $('#tpl', m).onclick = (e) => { e.preventDefault(); downloadTemplate(); };
      $('#cancel', m).onclick = close;
      // Ngày tốt nghiệp mặc định = ngày học cuối của khoá học (bỏ T7, CN), giảng viên có thể sửa
      let gradTouched = false;
      const iso = (d) => d.toISOString().slice(0, 10);
      function autoGrad() {
        if (gradTouched) return;
        const start = $('#cd', m).value; if (!start) return;
        const days = sessList.filter((x) => x.class_type_id === $('#ct', m).value);
        const withDay = days.filter((x) => x.day_no);
        const n = withDay.length ? Math.max(...withDay.map((x) => x.day_no)) : days.length;
        const d = new Date(start + 'T00:00:00Z');
        if (withDay.length) { let k = 0; while (k < n - 1) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; } }
        else d.setUTCDate(d.getUTCDate() + Math.max(n - 1, 0));
        $('#cg', m).value = iso(d);
      }
      $('#cg', m).onchange = () => { gradTouched = true; };
      const drawNP = () => { const tid = $('#ct', m).value; const ty = types.find((x) => x.id === tid);
        renderNodePicker(m, allNodes.filter((n) => n.class_type_id === tid), ty && ty.name, sessList.filter((x) => x.class_type_id === tid)); };
      $('#cd', m).onchange = autoGrad; $('#ct', m).onchange = () => { autoGrad(); drawNP(); }; autoGrad(); drawNP();
      $('#cf', m).onsubmit = (e) => {
        e.preventDefault();
        busy($('#ok', m), async () => {
          let codes = [];
          const f = $('#cx', m).files[0];
          if (f) { const r = await importStudents(f); codes = codes.concat(r.codes); if (r.skipped) toast(`Bỏ qua ${r.skipped} dòng thiếu thông tin`); }
          codes = Array.from(new Set(codes));
          if (!codes.length && !confirm('Chưa có học viên nào (chưa chọn file Excel). Vẫn tạo lớp? Sau đó có thể thêm học viên trong lớp.')) return;
          const id = await q(db.rpc('create_class', {
            p_name: $('#cn', m).value.trim().toUpperCase(), p_type: $('#ct', m).value, p_start: $('#cd', m).value,
            p_codes: codes, p_grad: $('#cg', m).value || null, p_nodes: nodePickerValue(m),
          }));
          await q(db.from('classes').update({ location: $('#cl', m).value.trim() || null, open_enrollment: $('#ce', m).checked }).eq('id', id));
          const miss = codes.length ? await missingCodes(codes) : [];
          close();
          toast(codes.length ? `Đã tạo lớp, ${codes.length - miss.length} học viên` : 'Đã tạo lớp', 'ok');
          if (miss.length) toast(`Không tìm thấy mã: ${miss.slice(0, 8).join(', ')}${miss.length > 8 ? '...' : ''}`, 'err');
          nav('class/' + id);
        });
      };
    });
  }

  // ================================================================ GIẢNG VIÊN: chi tiết lớp
  async function viewClass(el, id) {
    const cls = await q(db.from('classes').select('*, class_types(name, max_absent)').eq('id', id).single());
    const sessions = await q(db.from('class_sessions').select('*').eq('class_id', id).order('session_no'));
    const roster = await q(db.from('class_students').select('student_code, node_ids, added_at, students(*)').eq('class_id', id));
    const cnodes = cls.class_type_id ? (await loadNodes()).filter((n) => n.class_type_id === cls.class_type_id) : [];
    const nodeOfSession = (sx) => { const n = cnodes.find((x) => x.id === sx.node_id); return n ? nodeCode(cls.class_types?.name, n, cnodes) : ''; };
    const att = sessions.length ? await fetchAll(() => db.from('attendance')
      .select('id, session_id, student_code, checked_at, source, late').in('session_id', sessions.map((s) => s.id)).order('id')) : [];
    const profs = roster.length ? await fetchAll(() => db.from('profiles').select('student_code, device_id')
      .eq('role', 'student').order('id')) : [];
    const hasDevice = new Set(profs.filter((p) => p.device_id).map((p) => p.student_code));

    const perSession = {}; const perStudent = {};
    att.forEach((a) => {
      perSession[a.session_id] = (perSession[a.session_id] || 0) + 1;
      perStudent[a.student_code] = (perStudent[a.student_code] || 0) + 1;
    });
    const total = roster.length;
    const inScope = (r, sx) => !cnodes.length || inNodes(r.node_ids, sx.node_id, cnodes);
    const perTotal = {}; sessions.forEach((sx) => { perTotal[sx.id] = roster.filter((r) => inScope(r, sx)).length; });
    const attSet = new Set(att.map((a) => a.session_id + '|' + a.student_code));
    const attMap = {}; att.forEach((a) => { attMap[a.session_id + '|' + a.student_code] = a; });
    const maxAbsent = cls.class_types?.max_absent;
    // Vắng tính theo module (cấp 2): mỗi module có số buổi được vắng riêng (mặc định 1). Không tính buổi MOF, buổi ngoài module, buổi mở trước ngày học viên vào lớp.
    const exempt = (r, sx) => !!(r.added_at && sx.opened_at && sx.opened_at < r.added_at && !attSet.has(sx.id + '|' + r.student_code));
    const modOf = (sx) => { const n = cnodes.find((x) => x.id === sx.node_id); if (!n) return null; return n.parent_id ? cnodes.find((x) => x.id === n.parent_id) || n : n; };
    const absent = {}; const mstat = {}; const level = {};
    roster.forEach((r) => {
      const code = r.student_code; const mine = sessions.filter((sx) => inScope(r, sx) && !exempt(r, sx));
      absent[code] = absentCount(mine, code, attSet);
      const by = {};
      mine.forEach((sx) => { const m = modOf(sx); const key = m ? m.id : '_'; const e = by[key] || (by[key] = { label: m ? m.code : 'Cả khoá', max: m ? (m.max_absent == null ? 1 : m.max_absent) : (cls.class_types?.max_absent ?? null), used: 0 });
        if (sx.opened_at && sx.counts_absent !== false && !attSet.has(sx.id + '|' + code)) e.used++; });
      mstat[code] = Object.values(by);
      level[code] = mstat[code].some((e) => e.max != null && e.used > e.max) ? 2 : mstat[code].some((e) => e.max != null && e.used >= 1 && e.used === e.max) ? 1 : 0;
    });
    const teachers = await q(db.rpc('list_teachers'));
    const tas = await q(db.rpc('list_tas')).catch(() => []);
    // ứng viên trợ giảng: học viên đã được nâng lên trợ giảng + giảng viên (giảng viên có thể là trợ giảng lớp khác)
    const taCands = tas.map((t) => ({ email: String(t.email).toLowerCase(), label: (t.full_name || t.code) + ' (HV ' + t.code + ')' }))
      .concat(teachers.map((t) => ({ email: String(t.email).toLowerCase(), label: (t.full_name || t.email) + ' (GV)' })));
    const taName = (e) => { const c = taCands.find((x) => x.email === String(e || '').toLowerCase()); return c ? c.label : e; };
    const classTA = cls.ta_email ? String(cls.ta_email).toLowerCase() : '';
    const ended = !!cls.ended_at;
    const canEnd = me.role === 'admin' || cls.created_by === me.id;
    const over = roster.filter((r) => level[r.student_code] === 2); const full = roster.filter((r) => level[r.student_code] === 1);
    const modTxt = (r, lv) => mstat[r.student_code].filter((e) => e.max != null && (lv === 2 ? e.used > e.max : e.used === e.max && e.used >= 1)).map((e) => `${esc(e.label)} ${e.used}/${e.max}`).join(', ');
    roster.sort((a, b) => String(a.students?.full_name).localeCompare(String(b.students?.full_name), 'vi'));

    el.innerHTML = `
      <p><a href="#/classes">&larr; Danh sách lớp</a></p>
      ${ended ? `<div class="card" style="border-color:#e0b4ba;background:#fff4f5"><b style="color:var(--bad)">Lớp đã kết thúc</b>
        <span class="small muted"> · ${esc(fmtTime(cls.ended_at))}${cls.ended_by ? ' · bởi ' + esc(cls.ended_by) : ''}. Không thể mở QR hay sửa điểm danh.</span>
        ${me.role === 'admin' ? '<div style="margin-top:8px"><button class="btn pink" id="reopen">Mở lại lớp (admin)</button></div>' : '<div class="small muted" style="margin-top:4px">Chỉ admin mới mở lại được lớp.</div>'}</div>` : ''}
      <div class="card">
        <div><h2>${esc(cls.name)}</h2>
          <span class="muted">${esc(cls.class_types?.name || '')} · bắt đầu ${esc(fmtDate(cls.start_date))}${cls.graduation_date ? ' · tốt nghiệp ' + esc(fmtDate(cls.graduation_date)) : ''}</span></div>
        <div class="grid2" style="margin-top:10px">
          <div><label>Địa điểm học</label><input id="loc" value="${esc(cls.location || '')}" placeholder="Nhập địa điểm học"></div>
          <div><label>Đăng ký</label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="oen" style="width:auto"${cls.open_enrollment ? ' checked' : ''}> Mở đăng ký cho học viên</label></div></div>
        ${canEnd ? `<div style="margin-top:10px"><label>Vị trí lớp (để kiểm tra khu vực điểm danh)</label>
          <div class="row"><button class="btn ghost sm" id="setgeo" type="button">Đặt vị trí lớp = vị trí hiện tại của tôi</button>
            <span class="small">Bán kính <input id="rad" type="number" min="30" max="2000" value="${cls.radius_m || 200}" style="width:80px;display:inline-block"> m</span></div>
          <div class="small muted" id="geost">${cls.lat != null ? 'Đã đặt vị trí lớp (' + cls.lat.toFixed(5) + ', ' + cls.lng.toFixed(5) + ')' : 'Chưa đặt vị trí lớp: hệ thống chỉ ghi vị trí học viên, chưa so sánh.'}</div></div>` : ''}
        <div style="margin-top:10px"><label>Trợ giảng của lớp <span class="muted small">(mỗi lớp 1 người)</span></label>
          ${canEnd && !ended ? `<div class="row"><select id="clsta" style="flex:1 1 220px;min-width:0"><option value="">(Chưa có trợ giảng)</option>
            ${taCands.map((c) => `<option value="${esc(c.email)}"${c.email === classTA ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
            <button class="btn ghost sm" id="taall" type="button">Gán cho tất cả buổi chưa mở</button></div>
            <div class="small muted">Chọn trợ giảng của lớp rồi chọn buổi nào có trợ giảng ở danh sách buổi học bên dưới.</div>`
            : `<div>${classTA ? esc(taName(classTA)) : '<span class="muted">Chưa có trợ giảng</span>'}</div>`}</div>
        <div class="btnrow"><button class="btn ghost" id="exp">Xuất Excel</button>
          ${canEnd && !ended ? '<button class="btn ghost" id="endcls">Kết thúc lớp</button>' : ''}
          <button class="btn danger" id="del">Xóa lớp</button></div>
      </div>
      ${over.length || full.length ? `<div class="card warnbox ${over.length ? 'w-over' : 'w-full'}">
        <details${over.length ? ' open' : ''}><summary><b>⚠ Cảnh báo vắng:</b> ${over.length ? `<span class="badge bad">${over.length} vượt</span> ` : ''}${full.length ? `<span class="badge warn">${full.length} hết lượt</span>` : ''}</summary>
        <div class="small" style="margin-top:6px">${over.map((r) => `<a href="#" data-goto="${esc(r.student_code)}"><b>${esc(r.students?.full_name || r.student_code)}</b></a> · vượt ${modTxt(r, 2)}`).concat(full.map((r) => `<a href="#" data-goto="${esc(r.student_code)}">${esc(r.students?.full_name || r.student_code)}</a> · hết lượt ${modTxt(r, 1)}`)).join('<br>')}</div></details></div>` : ''}
      <div class="card"><h3>Các buổi học</h3>
        <div class="small muted">Chọn ngày, ca, giảng viên, trợ giảng ngay trên bảng. Muốn điểm danh tay hoặc hủy điểm danh: bấm <b>Chi tiết</b>. Ca chỉ đổi được khi buổi chưa mở QR.</div>
        <div class="tbl-wrap"><table class="ctab stab">
          <thead><tr><th>STT</th><th>Nội dung</th><th>Mã khoá</th><th>Ngày</th><th>Ca</th><th>GV</th><th>TG</th><th>Trạng thái</th><th>Có mặt</th><th></th></tr></thead>
          <tbody>${sessions.map((s, i) => `<tr>
            <td class="n">${i + 1}</td>
            <td class="s-bc">${esc(s.content || '')}</td>
            <td class="cd">${nodeOfSession(s) ? esc(nodeOfSession(s)) : '—'}</td>
            <td><input type="date" value="${s.session_date || ''}" data-date="${s.id}"></td>
            <td><select data-shift="${s.id}"${ended || s.opened_at ? ' disabled' : ''}><option value=""${s.shift ? '' : ' selected'}>Chọn ca</option>${Object.keys(SHIFT_LABEL).map((k) => `<option value="${k}"${s.shift === k ? ' selected' : ''}>${SHIFT_LABEL[k]}</option>`).join('')}</select></td>
            <td><select data-teacher="${s.id}"><option value="">(Chưa gán)</option>${teachers.map((t) => `<option value="${esc(t.email)}"${t.email === String(s.teacher_email || '').toLowerCase() ? ' selected' : ''}>${esc(t.full_name || t.email)}${t.has_account ? '' : ' (chưa tạo TK)'}</option>`).join('')}</select></td>
            <td><select data-ta="${s.id}"${classTA && !ended ? '' : ' disabled'}><option value="">${classTA ? '(Không có)' : '(Lớp chưa có TG)'}</option>
              ${classTA ? `<option value="${esc(classTA)}"${String(s.ta_email || '').toLowerCase() === classTA ? ' selected' : ''}>${esc(taName(classTA))}</option>` : ''}</select></td>
            <td>${s.closed ? '<span class="badge gray">Đã đóng</span>' : s.opened_at ? '<span class="badge ok">Đã mở</span>' : '<span class="badge warn">Chưa mở</span>'}${!s.teacher_email && !s.ta_email ? ' <span class="badge bad" title="Buổi cần có giảng viên hoặc trợ giảng">Chưa phân công</span>' : ''}</td>
            <td class="n"><b>${perSession[s.id] || 0}/${perTotal[s.id]}</b></td>
            <td class="s-act">${ended ? '' : qrButtons(s, true)} <a class="btn sm" href="#/session/${s.id}">Chi tiết</a></td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="card"><div class="row between"><h3 style="margin:0">Học viên (${total})</h3><button class="btn pink sm" id="add">+ Thêm học viên / up danh sách</button></div>
        <div class="small muted" style="margin-bottom:6px"><span class="sc ok inl">✓</span> đúng giờ &nbsp;<span class="sc late inl">M</span> muộn &nbsp;<span class="sc abs inl">V</span> vắng &nbsp;<span class="sc none inl">·</span> chưa học</div>
        <div class="plist">
          <div class="trow thead"><div>Học viên</div><div>Có mặt / Vắng</div><div>Từng buổi ${ended ? '' : '(bấm vào ô để điểm danh tay / hủy)'}</div><div></div></div>
          ${roster.map((r) => { const s = r.students || {}; return `<div class="trow">
            <div class="t-main"><b>${esc(s.full_name || r.student_code)}</b>
              <div class="small muted">${esc(r.student_code)}${s.title ? ' · ' + esc(s.title) : ''}</div>
              ${cnodes.length ? `<div class="pi-st">${nodeTags(r.node_ids, cnodes)} <span class="small muted">${sessions.filter((x) => inNodes(r.node_ids, x.node_id, cnodes)).length} buổi</span> ${ended ? '' : `<a href="#" data-nodes="${esc(r.student_code)}" class="small">Đổi module</a>`}</div>` : ''}</div>
            <div class="small">Có mặt <b>${perStudent[r.student_code] || 0}/${sessions.filter((sx) => inScope(r, sx)).length}</b><br>Vắng ${mstat[r.student_code].length ? mstat[r.student_code].map((e) => `<span class="badge ${e.max != null && e.used > e.max ? 'bad' : e.max != null && e.used >= 1 && e.used === e.max ? 'warn' : 'gray'}" title="${esc(e.label)}: vắng ${e.used}, được vắng ${e.max == null ? '—' : e.max}">${esc(e.label)} ${e.used}${e.max != null ? '/' + e.max : ''}</span>`).join(' ') : '<b>0</b>'}</div>
            <div>${sessGrid(sessions, attMap, r.student_code, !ended, (sx) => inScope(r, sx) && !exempt(r, sx))}</div>
            <div class="t-act">${hasDevice.has(r.student_code) ? `<button class="btn sm ghost" data-reset="${esc(r.student_code)}">Đặt lại thiết bị</button>` : ''}
              <button class="btn sm ghost" data-resetpw="${esc(r.student_code)}">Đặt lại MK</button>
              <button class="btn sm danger" data-rm="${esc(r.student_code)}">Xóa</button></div></div>`; }).join('')}
        </div></div>`;

    $$('[data-goto]', el).forEach((a) => { a.onclick = (e) => { e.preventDefault(); const k = a.dataset.goto; const row = $$('.trow', el).find((d) => d.textContent.includes(k)); if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1800); } }; });
    $$('[data-nodes]', el).forEach((a) => { a.onclick = (e) => {
      e.preventDefault(); const r = roster.find((x) => x.student_code === a.dataset.nodes);
      editStudentNodes(id, r.student_code, (r.students && r.students.full_name) || r.student_code, r.node_ids, cnodes, render); }; });
    // Bấm vào ô của 1 buổi: đã điểm danh -> Hủy điểm danh; chưa -> Điểm danh tay (chỉ áp dụng cho buổi đó)
    $$('[data-cell]', el).forEach((b) => { b.onclick = () => {
      const sess = sessions.find((x) => x.id === b.dataset.cell); const code = b.dataset.code;
      const stu = (roster.find((r) => r.student_code === code) || {}).students || {};
      const a = attMap[sess.id + '|' + code];
      modal(`<h3 style="text-align:center">Buổi ${sess.session_no}${sess.shift ? ' · ' + SHIFT_LABEL[sess.shift] : ''}</h3>
        <p style="text-align:center"><b>${esc(stu.full_name || code)}</b><br><span class="small muted">${esc(code)} · ${esc(fmtDate(sess.session_date))}</span></p>
        <p style="text-align:center">${a ? `Đã điểm danh lúc <b>${esc(fmtTime(a.checked_at))}</b>${a.source === 'manual' ? ' (giảng viên điểm danh tay)' : a.late ? ' (muộn)' : ''}.` : 'Chưa có điểm danh ở buổi này.'}</p>
        <div class="row" style="justify-content:center;margin-top:10px">
          ${a ? '<button class="btn danger" id="cu">Hủy điểm danh</button>' : '<button class="btn pink" id="cm">Điểm danh tay</button>'}
          <button class="btn ghost" id="cx">Đóng</button></div>`, (m, close) => {
        $('#cx', m).onclick = close;
        if (a) $('#cu', m).onclick = () => busy($('#cu', m), async () => { await q(db.from('attendance').delete().eq('id', a.id)); close(); toast('Đã hủy điểm danh', 'ok'); render(); });
        else $('#cm', m).onclick = () => busy($('#cm', m), async () => {
          await q(db.from('attendance').insert({ session_id: sess.id, student_code: code, student_name: stu.full_name || code, source: 'manual' }));
          close(); toast('Đã điểm danh tay', 'ok'); render(); });
      });
    }; });

    $('#loc').onchange = () => busy(null, async () => { await q(db.from('classes').update({ location: $('#loc').value.trim() || null }).eq('id', id)); toast('Đã lưu địa điểm', 'ok'); });
    $('#oen').onchange = () => busy(null, async () => { await q(db.from('classes').update({ open_enrollment: $('#oen').checked }).eq('id', id)); toast($('#oen').checked ? 'Đã mở đăng ký cho học viên' : 'Đã đóng đăng ký', 'ok'); });
    if ($('#setgeo')) $('#setgeo').onclick = (e) => busy(e.target, () => new Promise((ok, no) => {
      if (!navigator.geolocation) { no(new Error('Trình duyệt không hỗ trợ định vị')); return; }
      navigator.geolocation.getCurrentPosition(async (p) => {
        try {
          const rad = Math.max(30, Math.min(2000, Number($('#rad').value) || 200));
          await q(db.from('classes').update({ lat: p.coords.latitude, lng: p.coords.longitude, radius_m: rad }).eq('id', id));
          $('#geost').textContent = `Đã đặt vị trí lớp (${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}), bán kính ${rad} m`;
          toast('Đã lưu vị trí lớp', 'ok'); ok();
        } catch (er) { no(er); }
      }, () => no(new Error('Không lấy được vị trí. Hãy cho phép quyền vị trí cho trình duyệt')), { enableHighAccuracy: true, timeout: 20000 });
    }));
    if ($('#reopen')) $('#reopen').onclick = (e) => { if (!confirm('Mở lại lớp này?')) return; busy(e.target, async () => { await q(db.rpc('reopen_class', { p_class: id })); toast('Đã mở lại lớp', 'ok'); render(); }); };
    if ($('#endcls')) $('#endcls').onclick = () => {
      const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().slice(0, 10);
      const lastDay = sessions.map((s) => s.session_date).filter(Boolean).sort().pop();
      const early = lastDay && lastDay >= today;
      modal(`<h3 style="text-align:center">${early ? '⚠ Chưa hết ngày học' : 'Kết thúc lớp'}</h3>
        <p>${early ? `Lớp này còn buổi học đến <b>${esc(fmtDate(lastDay))}</b>. ` : ''}Khi kết thúc lớp:</p>
        <ul class="small"><li>Không mở được mã QR và không sửa được điểm danh nữa.</li><li>Chỉ <b>admin</b> mới mở lại được lớp.</li></ul>
        <div class="row" style="justify-content:center;margin-top:12px"><button class="btn danger" id="yesend">Kết thúc lớp</button><button class="btn ghost" id="noend">Hủy</button></div>`, (m, close) => {
        $('#noend', m).onclick = close;
        $('#yesend', m).onclick = () => busy($('#yesend', m), async () => { await q(db.rpc('end_class', { p_class: id })); close(); toast('Đã kết thúc lớp', 'ok'); render(); });
      });
    };
    $('#exp').onclick = (e) => busy(e.target, () => exportReport([id]));
    $('#add').onclick = () => openAddStudents(id);
    $('#del').onclick = (e) => {
      if (!confirm('Xóa lớp này cùng toàn bộ dữ liệu điểm danh? Không thể hoàn tác.')) return;
      busy(e.target, async () => { await q(db.from('classes').delete().eq('id', id)); toast('Đã xóa lớp', 'ok'); nav('classes'); });
    };
    $$('[data-date]', el).forEach((i) => { i.onchange = () => busy(null, async () => {
      await q(db.from('class_sessions').update({ session_date: i.value || null }).eq('id', i.dataset.date)); toast('Đã lưu ngày học', 'ok'); }); });
    $$('[data-shift]', el).forEach((sel) => { sel.onchange = () => busy(null, async () => {
      await q(db.from('class_sessions').update({ shift: sel.value || null }).eq('id', sel.dataset.shift)); toast('Đã đổi ca học', 'ok'); render(); }); });
    $$('[data-ta]', el).forEach((sel) => { sel.onchange = () => busy(null, async () => {
      await q(db.from('class_sessions').update({ ta_email: sel.value || null }).eq('id', sel.dataset.ta));
      toast(sel.value ? 'Đã gán trợ giảng cho buổi' : 'Đã bỏ trợ giảng khỏi buổi', 'ok'); render(); }); });
    if ($('#clsta')) $('#clsta').onchange = () => busy(null, async () => {
      await q(db.from('classes').update({ ta_email: $('#clsta').value || null }).eq('id', id));
      toast($('#clsta').value ? 'Đã đặt trợ giảng của lớp. Hãy chọn buổi có trợ giảng bên dưới' : 'Đã bỏ trợ giảng của lớp', 'ok'); render(); });
    if ($('#taall')) $('#taall').onclick = (e) => busy(e.target, async () => {
      if (!$('#clsta').value) throw new Error('Hãy chọn trợ giảng của lớp trước');
      await q(db.from('class_sessions').update({ ta_email: $('#clsta').value }).eq('class_id', id).is('opened_at', null));
      toast('Đã gán trợ giảng cho các buổi chưa mở', 'ok'); render(); });
    $$('[data-teacher]', el).forEach((sel) => { sel.onchange = () => busy(null, async () => {
      await q(db.from('class_sessions').update({ teacher_email: sel.value || null }).eq('id', sel.dataset.teacher)); toast('Đã đổi giảng viên', 'ok'); }); });
    $$('[data-close]', el).forEach((b) => { b.onclick = () => busy(b, async () => {
      await q(db.rpc('close_qr', { p_session: b.dataset.close })); render(); }); });
    bindResetQR(el);
    $$('[data-reset]', el).forEach((b) => { b.onclick = () => busy(b, async () => {
      await q(db.rpc('reset_device', { p_student_code: b.dataset.reset })); toast('Đã đặt lại thiết bị', 'ok'); render(); }); });
    $$('[data-resetpw]', el).forEach((b) => { b.onclick = () => resetPassword(b, b.dataset.resetpw); });
    $$('[data-rm]', el).forEach((b) => { b.onclick = () => {
      if (!confirm('Xóa học viên này khỏi lớp? Dữ liệu điểm danh của học viên trong lớp này cũng bị xóa.')) return;
      busy(b, async () => {
        const sids = sessions.map((x) => x.id);
        if (sids.length) await q(db.from('attendance').delete().eq('student_code', b.dataset.rm).in('session_id', sids));
        await q(db.from('class_students').delete().eq('class_id', id).eq('student_code', b.dataset.rm));
        toast('Đã xóa học viên khỏi lớp', 'ok'); render(); }); }; });
  }

  function resetPassword(btn, code) {
    if (!confirm('Đặt lại mật khẩu của học viên ' + code + '?\nMật khẩu quay về mã học viên, lần đăng nhập sau phải đổi mật khẩu. Thiết bị điểm danh cũng được đặt lại. Lịch sử điểm danh vẫn giữ.')) return;
    busy(btn, async () => {
      await q(db.rpc('reset_student_account', { p_student_code: code }));
      toast('Đã đặt lại mật khẩu về mã học viên', 'ok'); render();
    });
  }

  function openAddStudents(classId) {
    const sel = new Map(); // code -> họ tên
    modal(`<h2>Thêm học viên vào lớp</h2>
      <form id="af">
        <div id="npbox"></div>
        <div class="cset" style="margin-top:10px"><b>1. Up từ file Excel</b> <span class="badge ok">Ưu tiên</span>
          <input id="ax" type="file" accept=".xlsx,.xls,.csv" style="margin-top:6px">
          <div class="small muted">Nhận luôn file <b>Hồ sơ lớp</b> có sẵn (tự lấy sheet DS HOC VIEN: Mã số tạm + Họ và tên), không cần chuyển mẫu. <a href="#" id="tpl">Tải file mẫu</a></div></div>
        <div class="cset" style="margin-top:10px"><b>2. Hoặc tìm trong kho học viên</b>
          <input id="as" placeholder="Gõ tên hoặc mã (từ 2 ký tự)..." autocomplete="off" style="margin-top:6px">
          <div class="chips" id="achips"></div>
          <div class="pick" id="alist" style="display:none"></div></div>
        <div class="row" style="margin-top:14px"><button class="btn pink" id="ok">Thêm</button>
          <button type="button" class="btn ghost" id="cancel">Hủy</button></div>
      </form>`, (m, close) => {
      const drawChips = () => {
        $('#achips', m).innerHTML = Array.from(sel).map(([c, n]) => `<span class="badge ok" data-x="${esc(c)}" title="Bỏ chọn">${esc(n)} ✕</span>`).join('');
        $$('[data-x]', m).forEach((b) => { b.onclick = () => { sel.delete(b.dataset.x); drawChips(); doSearch(); }; });
        $('#ok', m).textContent = sel.size ? `Thêm (${sel.size})` : 'Thêm';
      };
      let seq = 0, timer = null;
      const doSearch = async () => {
        const v = $('#as', m).value.trim(); const box = $('#alist', m);
        if (v.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
        const my = ++seq; box.style.display = '';
        box.innerHTML = '<div class="small muted" style="padding:10px">Đang tìm...</div>';
        try {
          const list = await q(db.rpc('search_students', { p_q: v, p_class: classId }));
          if (my !== seq) return;
          box.innerHTML = list.length ? list.map((s) => `<label class="pk${s.in_class ? ' dis' : ''}"><input type="checkbox" data-c="${esc(s.code)}" data-n="${esc(s.full_name)}"${s.in_class ? ' disabled' : sel.has(s.code) ? ' checked' : ''}>
            <span><b>${esc(s.full_name)}</b>${s.in_class ? ' <span class="badge gray">Đã trong lớp</span>' : ''}<small>${esc(s.code)}${s.title ? ' · ' + esc(s.title) : ''}</small></span></label>`).join('')
            + (list.length >= 20 ? '<div class="small muted" style="padding:8px 10px">Hiển thị 20 kết quả đầu, gõ thêm để lọc.</div>' : '')
            : '<div class="small muted" style="padding:10px">Không tìm thấy học viên nào.</div>';
          $$('[data-c]', box).forEach((cb) => { cb.onchange = () => { if (cb.checked) sel.set(cb.dataset.c, cb.dataset.n); else sel.delete(cb.dataset.c); drawChips(); }; });
        } catch (e) { if (my === seq) box.innerHTML = `<div class="small" style="padding:10px;color:var(--bad)">${esc(errMsg(e))}</div>`; }
      };
      q(db.from('classes').select('class_type_id, class_types(name)').eq('id', classId).single()).then(async (c) => {
        const ns = (await loadNodes()).filter((n) => n.class_type_id === c.class_type_id);
        const ss = await q(db.from('class_sessions').select('session_no, node_id, counts_absent').eq('class_id', classId));
        renderNodePicker(m, ns, c.class_types && c.class_types.name, ss); }).catch(() => {});
      $('#as', m).oninput = () => { clearTimeout(timer); timer = setTimeout(doSearch, 300); };
      $('#tpl', m).onclick = (e) => { e.preventDefault(); downloadTemplate(); };
      $('#cancel', m).onclick = close;
      $('#af', m).onsubmit = (e) => {
        e.preventDefault();
        busy($('#ok', m), async () => {
          let codes = Array.from(sel.keys());
          const nodesVal = nodePickerValue(m);
          let store = null;
          const f = $('#ax', m).files[0];
          if (f) {
            const { rows } = await readStudentsFile(f); // file lỗi thì báo lỗi, không thêm gì
            store = await addToStore(rows); // kho: mã đã có giữ nguyên, mã mới thì thêm
            codes = codes.concat(store.codes);
          }
          codes = Array.from(new Set(codes));
          if (!codes.length) throw new Error('Chưa chọn file hoặc học viên nào');
          const res = await q(db.rpc('add_class_students', { p_class: classId, p_codes: codes, p_nodes: nodesVal }));
          const miss = res.missing || [];
          close();
          toast(`Vào lớp: thêm ${res.added}${res.updated ? `, mở rộng phần học ${res.updated}` : ''}${res.skipped ? `, giữ nguyên ${res.skipped} (đã có phần học này)` : ''}`
            + (store ? `. Kho: thêm mới ${store.added}, đã có ${store.existed}` : ''), 'ok');
          if (miss.length) toast(`Không tìm thấy mã: ${miss.slice(0, 8).join(', ')}`, 'err');
          render();
        });
      };
    });
  }

  const SHIFT_LABEL = { sang: 'Sáng', chieu: 'Chiều', toi: 'Tối' };
  // Số buổi vắng = buổi đã mở điểm danh mà học viên không có bản ghi nào (buổi Thi MOF không tính)
  // Ô trạng thái từng buổi của 1 học viên: ✓ đúng giờ (xanh) / M muộn (cam) / V vắng (đỏ) / · chưa học
  function sessGrid(sessions, attMap, code, editable, inScope) {
    return `<div class="sgrid">${sessions.map((s) => {
      if (inScope && !inScope(s)) return `<span class="sc off" title="Buổi ${s.session_no}: học viên không học buổi này"><i>${s.session_no}</i>–</span>`;
      const a = attMap[s.id + '|' + code];
      let c = 'none', t = '·', tip = 'Chưa học';
      if (a) { if (a.source !== 'manual' && a.late) { c = 'late'; t = 'M'; tip = 'Muộn'; } else { c = 'ok'; t = '✓'; tip = 'Có mặt'; } }
      else if (s.opened_at) { c = s.counts_absent === false ? 'abs0' : 'abs'; t = 'V'; tip = s.counts_absent === false ? 'Vắng (không tính)' : 'Vắng'; }
      const inner = `<i>${s.session_no}</i>${t}`;
      return editable ? `<button type="button" class="sc ${c}" data-cell="${s.id}" data-code="${esc(code)}" title="Buổi ${s.session_no}: ${tip}. Bấm để sửa">${inner}</button>`
        : `<span class="sc ${c}" title="Buổi ${s.session_no}: ${tip}">${inner}</span>`;
    }).join('')}</div>`;
  }

  function absentCount(sessions, code, attSet) {
    return sessions.filter((s) => s.opened_at && s.counts_absent !== false && !attSet.has(s.id + '|' + code)).length;
  }

  // ================================================================ GIẢNG VIÊN: chi tiết buổi học
  function lateInfo(sess, cls, a) {
    if (!a) return sess.opened_at ? 'Vắng' : 'Chưa mở';
    if (a.source === 'manual') return 'Có mặt (điểm danh tay)';
    return a.late ? 'Muộn' : 'Đúng giờ';
  }

  // Vị trí điểm danh: ngoài khu vực / trong khu vực / chưa có tọa độ lớp
  function locBadge(a) {
    if (!a || a.source === 'manual') return '';
    if (a.out_of_area === true) return `<span class="badge bad" title="${a.dist_m != null ? 'Cách lớp khoảng ' + Math.round(a.dist_m) + ' m' : 'Không có vị trí / chưa cho phép'}">Ngoài khu vực</span>`;
    if (a.out_of_area === false) return `<span class="badge ok" title="Cách lớp khoảng ${Math.round(a.dist_m || 0)} m">Trong khu vực</span>`;
    return '<span class="badge gray" title="Lớp chưa đặt vị trí">Chưa đối chiếu</span>';
  }
  async function viewSession(el, id) {
    const sess = await q(db.from('class_sessions').select('*, classes(id, name, ended_at)').eq('id', id).single());
    const cls = sess.classes;
    const ended = !!cls.ended_at;
    const roster = await q(db.from('class_students').select('student_code, node_ids, students(*)').eq('class_id', cls.id));
    const clsRow = await q(db.from('classes').select('class_type_id').eq('id', cls.id).single());
    const cn = clsRow.class_type_id ? (await loadNodes()).filter((n) => n.class_type_id === clsRow.class_type_id) : [];
    const att = await q(db.from('attendance').select('*').eq('session_id', id));
    const map = {}; att.forEach((a) => { map[a.student_code] = a; });
    roster.sort((a, b) => String(a.students?.full_name).localeCompare(String(b.students?.full_name), 'vi'));
    const stat = { 'Đúng giờ': 0, 'Muộn': 0, 'Vắng': 0 };
    const rows = roster.map((r) => {
      const a = map[r.student_code];
      if (cn.length && !inNodes(r.node_ids, sess.node_id, cn)) return { r, a: null, st: 'Không học', off: true };
      const st = lateInfo(sess, cls, a);
      if (stat[st] !== undefined) stat[st]++; else if (st.startsWith('Có mặt')) stat['Đúng giờ']++;
      return { r, a, st };
    });
    const badge = (st) => (st === 'Không học' ? 'gray' : st === 'Vắng' ? 'bad' : st === 'Muộn' ? 'warn' : st === 'Chưa mở' ? 'gray' : 'ok');

    el.innerHTML = `
      <p><a href="#/class/${cls.id}">&larr; ${esc(cls.name)}</a></p>
      <div class="card"><div class="row between">
        <div><h2>Buổi ${sess.session_no}: ${esc(sess.content || '')}</h2>
          <span class="muted">${esc(fmtDate(sess.session_date))}${sess.opened_at ? ' · mở điểm danh lúc ' + esc(fmtTime(sess.opened_at)) : ''}</span></div>
        ${ended ? '<span class="badge bad">Lớp đã kết thúc</span> ' : ''}${sess.closed ? '<span class="badge gray">Đã đóng</span> ' : ''}${ended ? '' : qrOpenable(sess) ? `<a class="btn pink" href="#/qr/${id}">Mở QR điểm danh</a>` : (me.role === 'admin' ? `<button class="btn ghost" data-resetqr="${id}">Reset QR</button>` : '')}</div>
        <div class="stat" style="margin-top:12px">
          <div class="chip"><b>${stat['Đúng giờ']}</b>Đúng giờ</div><div class="chip"><b>${stat['Muộn']}</b>Muộn</div>
          <div class="chip"><b>${stat['Vắng']}</b>Vắng</div><div class="chip"><b>${rows.filter((x) => !x.off).length}</b>Tổng</div><div class="chip"><b>${att.filter((x) => x.out_of_area === true).length}</b>Ngoài khu vực</div></div></div>
      <div class="card"><h3>Điểm danh buổi này</h3>
        <div class="small muted">${ended ? 'Lớp đã kết thúc nên không sửa được điểm danh.' : 'Bấm <b>Điểm danh tay</b> để ghi có mặt, hoặc <b>Hủy điểm danh</b> để xóa điểm danh của học viên. Chỉ áp dụng cho buổi này.'}</div>
        <input id="fs" placeholder="Tìm theo mã, tên..." style="margin-top:10px">
        <div class="seg" id="fseg"><button data-f="all" class="on">Tất cả (${rows.length})</button><button data-f="no">Chưa điểm danh (${rows.filter((x) => !x.a && !x.off).length})</button><button data-f="yes">Đã điểm danh (${rows.filter((x) => x.a).length})</button></div>
        <div class="plist" id="pl">
        ${rows.map(({ r, a, st, off }) => `<div class="pi${off ? ' off' : ''}" data-k="${esc(norm(r.student_code + ' ' + (r.students?.full_name || '')))}" data-has="${a ? 1 : 0}" data-off="${off ? 1 : 0}">
          <div class="pi-main"><b>${esc(r.students?.full_name || r.student_code)}</b>
            <div class="small muted">${esc(r.student_code)}${r.students?.title ? ' · ' + esc(r.students.title) : ''}</div>
            <div class="pi-st"><span class="badge ${badge(st)}">${esc(st)}</span>${a ? `<span class="small">${esc(fmtTime(a.checked_at))}</span>` : ''}${locBadge(a)}</div></div>
          <div class="pi-act">${ended || off ? '' : a ? `<button class="btn sm danger" data-undo="${a.id}">Hủy điểm danh</button>`
            : `<button class="btn sm pink" data-manual="${esc(r.student_code)}" data-name="${esc(r.students?.full_name)}">Điểm danh tay</button>`}</div></div>`).join('')}
        </div></div>`;
    let flt = 'all';
    const applyF = () => { const k = norm($('#fs', el).value);
      $$('#pl .pi', el).forEach((d) => { d.classList.toggle('hide', !((!k || d.dataset.k.includes(k)) && (flt === 'all' || (d.dataset.off !== '1' && (flt === 'yes') === (d.dataset.has === '1'))))); }); };
    $('#fs', el).oninput = applyF;
    $$('#fseg button', el).forEach((b) => { b.onclick = () => { flt = b.dataset.f; $$('#fseg button', el).forEach((x) => x.classList.toggle('on', x === b)); applyF(); }; });
    bindResetQR(el);
    $$('[data-manual]', el).forEach((b) => { b.onclick = () => busy(b, async () => {
      await q(db.from('attendance').insert({ session_id: id, student_code: b.dataset.manual, student_name: b.dataset.name, source: 'manual' }));
      render(); }); });
    $$('[data-undo]', el).forEach((b) => { b.onclick = () => {
      if (!confirm('Hủy điểm danh của học viên này?')) return;
      busy(b, async () => { await q(db.from('attendance').delete().eq('id', b.dataset.undo)); render(); }); }; });
  }

  // ================================================================ GIẢNG VIÊN: màn hình QR xoay
  // Vẽ mã QR lên canvas (thư viện qrcode-generator)
  function drawQR(canvas, text, size) {
    const qr = window.qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    const cell = Math.max(2, Math.floor(size / (n + quiet * 2)));
    const px = cell * (n + quiet * 2);
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      }
    }
  }

  async function viewQR(id, isStale) {
    const sess = await q(db.rpc('qr_info', { p_session: id }))
      .catch((e) => { toast(errMsg(e), 'err'); nav(me.role === 'student' ? 'schedule' : 'classes'); return null; });
    if (!sess || isStale()) return;
    const total = sess.total;
    const backHref = me.role === 'student' ? '#/schedule' : '#/class/' + sess.class_id;
    const size = Math.floor(Math.min(window.innerWidth * 0.8, window.innerHeight * 0.5, 420));

    app.innerHTML = `
      <div class="qr-screen">
        <div class="row between" style="width:100%;max-width:700px">
          <a class="btn ghost sm" href="${backHref}">&larr; Thoát</a>
          <button class="btn sm danger" id="closeSess">Đóng điểm danh</button></div>
        <h2>${esc(sess.class_name)}<br><small style="font-weight:400">Buổi ${sess.session_no}: ${esc(sess.content || '')}</small></h2>
        <div class="qr-box"><canvas id="cv"></canvas></div>
        <div class="bar"><i id="bar"></i></div>
        <div class="muted small" style="color:#cfd6ee" id="hint">Mã tự đổi mỗi 10 giây</div>
        <div class="qr-stats"><div><b id="cnt">0</b> / ${total}<br><span class="small">đã điểm danh</span></div></div>
        <div class="qr-list" id="list"></div>
      </div>`;

    let stopped = false;
    let reopened = false;
    const timers = [];
    let explicitClosed = false;
    addCleanup(() => {
      stopped = true; timers.forEach(clearInterval); document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      if (!explicitClosed) db.rpc('close_qr', { p_session: id }).then(() => {}, () => {});
    });
    function onHide() {
      try {
        db.auth.getSession().then(({ data }) => {
          const t = data && data.session && data.session.access_token;
          if (!t) return;
          fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/close_qr', { method: 'POST', keepalive: true,
            headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_session: id }) });
        });
      } catch (_) {}
    }
    window.addEventListener('pagehide', onHide);

    // Vị trí người mở QR: nếu giảng viên và trợ giảng cùng mở thì phải cách nhau tối đa 200 m
    let pos = null, posAt = 0;
    const refreshPos = () => new Promise((ok) => {
      posAt = Date.now();
      if (!navigator.geolocation) { ok(null); return; }
      navigator.geolocation.getCurrentPosition((p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude }; ok(pos); }, () => ok(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
    async function loadToken() {
      if (stopped) return;
      if (!pos || Date.now() - posAt > 60000) await refreshPos();
      const { data, error } = await db.rpc('get_qr_token', { p_session: id, p_reopen: reopened, p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null });
      if (data && data.error === 'QR_EXPIRED') {
        timers.forEach(clearInterval); timers.length = 0;
        const box = $('.qr-box'); if (box) box.style.opacity = '.15';
        $('#hint').style.color = '#ffd27a';
        $('#hint').innerHTML = '<b>Hết giờ điểm danh.</b> Học viên quét sau giờ này sẽ tính là điểm danh muộn.<br><button class="btn sm" id="reopen" style="margin-top:8px">Mở lại mã QR</button>';
        $('#reopen').onclick = () => { reopened = true; if (box) box.style.opacity = ''; $('#hint').style.color = ''; $('#hint').textContent = 'Mã tự đổi mỗi 10 giây (điểm danh muộn)'; loadToken(); timers.push(setInterval(loadToken, 10000)); timers.push(setInterval(loadCount, 4000)); };
        return;
      }
      if (error || !data || data.error || !data.token) {
        $('#hint').textContent = errMsg(error || { message: (data && data.error) || 'Lỗi' }); $('#hint').style.color = '#ffb3be';
        timers.forEach(clearInterval); return;
      }
      drawQR($('#cv'), data.token, size);
      const bar = $('#bar');
      bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
      void bar.offsetWidth;
      bar.style.transition = 'transform 10s linear'; bar.style.transform = 'scaleX(0)';
    }
    async function loadCount() {
      if (stopped) return;
      const r = await q(db.rpc('qr_info', { p_session: id })).catch(() => null);
      if (!r) return;
      $('#cnt').textContent = r.count;
      $('#list').innerHTML = (r.recent || []).map((x) => `<div><span>${esc(x.student_name)}</span>
        <span class="muted">${esc(new Date(x.checked_at).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))}</span></div>`).join('');
    }
    function onVis() { if (!document.hidden) loadToken(); }
    document.addEventListener('visibilitychange', onVis);

    $('#closeSess').onclick = (e) => {
      if (!confirm('Đóng điểm danh buổi này? Học viên sẽ không quét được nữa.')) return;
      busy(e.target, async () => {
        explicitClosed = true;
        await q(db.rpc('close_qr', { p_session: id }));
        nav(me.role === 'student' ? 'schedule' : 'session/' + id);
      });
    };
    await loadToken(); await loadCount();
    timers.push(setInterval(loadToken, 10000));
    timers.push(setInterval(loadCount, 4000));
  }


  // ================================================================ LỊCH DẠY (dương lịch)
  async function viewSchedule(el) {
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = ymd(new Date());
    let cur = new Date(); cur.setDate(1);
    let selected = today;
    const MONTH = (d) => `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;

    async function draw() {
      const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const offset = (first.getDay() + 6) % 7; // thứ Hai là cột đầu
      const gridStart = new Date(first); gridStart.setDate(1 - offset);
      const weeks = Math.ceil((offset + last.getDate()) / 7);
      const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + weeks * 7 - 1);
      const rows = me.role === 'student' ? [] : await q(db.from('class_sessions')
        .select('id, session_no, content, session_date, shift, closed, opened_at, qr_reset_until, classes(id, name)')
        .eq('teacher_email', String(me.email || '').toLowerCase()).gte('session_date', ymd(gridStart)).lte('session_date', ymd(gridEnd))
        .order('session_date').order('session_no'));
      // buổi được phân công làm trợ giảng (kể cả giảng viên làm trợ giảng lớp khác)
      const taRows = await q(db.rpc('my_ta_sessions', { p_from: ymd(gridStart), p_to: ymd(gridEnd) })).catch(() => []);
      taRows.forEach((t) => { if (!rows.some((r) => r.id === t.id)) rows.push({ ...t, classes: { id: t.class_id, name: t.class_name }, as_ta: true }); });
      rows.sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)) || a.session_no - b.session_no);
      const by = {}; rows.forEach((r) => { (by[r.session_date] = by[r.session_date] || []).push(r); });

      let cells = '';
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
        const key = ymd(d); const list = by[key] || [];
        const out = d.getMonth() !== cur.getMonth();
        cells += `<button type="button" class="cal-cell${out ? ' out' : ''}${key === today ? ' today' : ''}${key === selected ? ' sel' : ''}" data-day="${key}">
          <span class="cal-n">${d.getDate()}</span>
          <span class="cal-dots">${list.map((r) => `<i class="${r.shift === 'chieu' ? 'c' : 's'}"></i>`).join('')}</span></button>`;
      }
      const day = by[selected] || [];
      const dd = new Date(selected + 'T00:00:00');
      const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
      el.innerHTML = `<div class="card">
        <div class="row between"><h2 style="margin:0">Lịch dạy</h2>
          <div class="row" style="gap:6px"><button class="btn ghost sm" id="pm">&lsaquo;</button>
            <b style="min-width:110px;text-align:center">${MONTH(cur)}</b>
            <button class="btn ghost sm" id="nm">&rsaquo;</button>
            <button class="btn ghost sm" id="tm">Hôm nay</button></div></div>
        <div class="cal">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((x) => `<div class="cal-h">${x}</div>`).join('')}${cells}</div>
        <div class="small muted" style="margin-top:8px"><i class="dot s"></i> Sáng &nbsp; <i class="dot c"></i> Chiều</div></div>
        <div class="card"><h3>${WD[dd.getDay()]}, ${fmtDate(selected)}</h3>
          ${day.length ? day.map((r) => `<div class="sch-item">
            <div><b>${esc(r.classes?.name)}</b> · Buổi ${r.session_no}${r.shift ? ' · ' + SHIFT_LABEL[r.shift] : ''}${r.as_ta ? ' <span class="badge">Trợ giảng</span>' : ''}
              <div class="small muted">${esc(r.content || '')}</div></div>
            <div class="btnrow">${r.closed ? '<span class="badge gray">Đã đóng</span>' : ''}${qrOpenable(r) ? `<a class="btn pink sm" href="#/qr/${r.id}">Mở QR điểm danh</a>` : (me.role === 'admin' ? `<button class="btn ghost sm" data-resetqr="${r.id}">Reset QR</button>` : '')}
              ${r.as_ta ? '' : `<a class="btn ghost sm" href="#/session/${r.id}">Chi tiết</a>`}</div></div>`).join('')
            : '<p class="muted">Không có buổi dạy nào trong ngày này.</p>'}</div>`;
      bindResetQR(el);
      $('#pm').onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); draw(); };
      $('#nm').onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); draw(); };
      $('#tm').onclick = () => { cur = new Date(); cur.setDate(1); selected = today; draw(); };
      $$('[data-day]', el).forEach((b) => { b.onclick = () => { selected = b.dataset.day; draw(); }; });
    }
    await draw();
  }

  // Ngày hôm nay (giờ VN) dạng YYYY-MM-DD, và lớp "đang học" = chưa kết thúc và chưa qua buổi cuối
  function vnToday() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function classIsActive(c, lastDate, today) { return !c.ended_at && (!lastDate || lastDate >= today); }

  // ================================================================ DANH SÁCH HỌC VIÊN
  async function viewRoster(el) {
    const isAdmin = me.role === 'admin';
    el.innerHTML = `<div class="card">
      <div class="row between"><h2>Học viên</h2>
        ${isAdmin ? `<div class="row"><button class="btn ghost" id="tpl">Tải file mẫu</button>
          <label class="btn pink" style="margin:0;cursor:pointer">Nhập từ Excel<input id="imp" type="file" accept=".xlsx,.xls,.csv" class="hide"></label></div>` : ''}</div>
      <input id="search" placeholder="Tìm theo mã, tên..." style="margin:12px 0">
      <div id="t" class="muted">Đang tải...</div></div>`;
    const students = await fetchAll(() => db.from('students').select('*').order('code'));
    const profs = await fetchAll(() => db.from('profiles').select('id, student_code, device_id, must_change_password').eq('role', 'student').order('id'));
    const pmap = {}; profs.forEach((p) => { if (p.student_code) pmap[p.student_code] = p; });
    const enr = await fetchAll(() => db.from('class_students').select('student_code, classes(id, name, created_at, ended_at)').order('student_code').order('class_id'));
    const lastBy = {};
    (await fetchAll(() => db.from('class_sessions').select('class_id, session_date').order('id'))).forEach((x) => {
      if (x.session_date && (!lastBy[x.class_id] || x.session_date > lastBy[x.class_id])) lastBy[x.class_id] = x.session_date; });
    const todayVN = vnToday();
    const cmap = {}; const doneN = {};
    enr.forEach((r) => {
      const c = r.classes; if (!c?.name) return;
      if (classIsActive(c, lastBy[c.id], todayVN)) (cmap[r.student_code] = cmap[r.student_code] || []).push(c);
      else doneN[r.student_code] = (doneN[r.student_code] || 0) + 1;
    });
    Object.values(cmap).forEach((a) => a.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)));

    function draw() {
      const k = norm($('#search').value);
      const list = students.filter((s) => !k || norm(s.code + s.full_name).includes(k));
      const shown = list.slice(0, 300);
      $('#t').innerHTML = `<p class="muted small">${list.length} học viên${list.length > 300 ? ' (hiển thị 300 đầu tiên, hãy tìm kiếm để lọc)' : ''}</p>
        <div class="plist">
        <div class="trow rrow thead"><div>Học viên</div><div>Lớp đang học</div><div></div></div>
        ${shown.map((s) => { const p = pmap[s.code]; return `<div class="trow rrow">
          <div class="t-main"><b>${esc(s.full_name)}</b><div class="small muted">${esc(s.code)}${s.title ? ' · ' + esc(s.title) : ''}</div></div>
          <div class="pi-st">${(cmap[s.code] || []).map((c) => `<span class="badge">${esc(c.name)}</span>`).join(' ') || '<span class="muted small">Không có</span>'}${doneN[s.code] ? `<span class="small muted">· đã học xong ${doneN[s.code]} lớp</span>` : ''}</div>
          <div class="t-act">${p ? `<button class="btn sm ghost" data-resetpw="${esc(s.code)}">Đặt lại MK</button>` : ''}
            ${p?.device_id ? `<button class="btn sm ghost" data-reset="${esc(s.code)}">Đặt lại thiết bị</button>` : ''}
            ${isAdmin && p ? `<button class="btn sm danger" data-deluser="${p.id}">Xóa tài khoản</button>` : ''}
            ${isAdmin ? `<button class="btn sm danger" data-delstu="${esc(s.code)}">Xóa HV</button>` : ''}</div></div>`; }).join('')}
        </div>`;
      $$('[data-reset]', el).forEach((b) => { b.onclick = () => busy(b, async () => {
        await q(db.rpc('reset_device', { p_student_code: b.dataset.reset })); toast('Đã đặt lại thiết bị', 'ok'); render(); }); });
      $$('[data-resetpw]', el).forEach((b) => { b.onclick = () => resetPassword(b, b.dataset.resetpw); });
      $$('[data-deluser]', el).forEach((b) => { b.onclick = () => {
        if (!confirm('Xóa tài khoản đăng nhập của học viên này? (Thông tin trong danh sách vẫn giữ)')) return;
        busy(b, async () => { await q(db.rpc('admin_delete_user', { p_user: b.dataset.deluser })); toast('Đã xóa tài khoản', 'ok'); render(); }); }; });
      $$('[data-delstu]', el).forEach((b) => { b.onclick = () => {
        if (!confirm('Xóa học viên này khỏi hệ thống (và khỏi mọi lớp)? Lịch sử điểm danh vẫn giữ.')) return;
        busy(b, async () => { await q(db.from('students').delete().eq('code', b.dataset.delstu)); toast('Đã xóa', 'ok'); render(); }); }; });
    }
    draw();
    $('#search').oninput = draw;
    if (isAdmin) { $('#tpl').onclick = downloadTemplate;
    $('#imp').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      busy(null, async () => {
        const r = await importStudents(f);
        toast(`Kho học viên: thêm mới ${r.added}, đã có sẵn ${r.existed} (giữ nguyên)${r.skipped ? `, bỏ qua ${r.skipped} dòng thiếu thông tin` : ''}`, 'ok');
        render();
      });
    }; }
  }

  // ================================================================ BÁO CÁO
  // ================================================================ XUẤT EXCEL THEO BIỂU MẪU ASAHI
  let _exl = null;
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    if (_exl) return _exl;
    _exl = new Promise((ok, no) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/exceljs-4.4.0.min.js';
      sc.onload = ok;
      sc.onerror = () => { _exl = null; no(new Error('Không tải được thư viện xuất Excel. Kiểm tra mạng rồi thử lại')); };
      document.head.appendChild(sc);
    });
    return _exl;
  }
  // sheets: [{ name, title, info:[[nhãn, giá trị]], cols:[{header,key,width,align,color(v)->argb}], rows:[{}], total:{key:giá trị}, sign:true }]
  async function saveXlsx(filename, sheets) {
    await loadExcelJS();
    const NAVY = 'FF002F72', GREY = 'FF6B7694', LINE = 'FFD5DBE8', ZEBRA = 'FFF3F6FB', FONT = 'Noto Sans';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asahi Academy · Training Delivery'; wb.created = new Date();
    const nowVN = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const dd = String(nowVN.getDate()).padStart(2, '0'), mm = String(nowVN.getMonth() + 1).padStart(2, '0');
    const stamp = `${dd}/${mm}/${nowVN.getFullYear()} ${String(nowVN.getHours()).padStart(2, '0')}:${String(nowVN.getMinutes()).padStart(2, '0')}`;
    for (const sh of sheets) {
      const n = sh.cols.length;
      const ws = wb.addWorksheet(sh.name.slice(0, 31), {
        views: [{ showGridLines: false }],
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: .4, right: .4, top: .6, bottom: .6, header: .3, footer: .3 } },
        headerFooter: { oddFooter: '&L&"Noto Sans"&8Asahi Academy · Training Delivery&R&"Noto Sans"&8Trang &P/&N' },
      });
      ws.columns = sh.cols.map((c) => ({ width: c.width || 14 }));
      const mergeRow = (r) => { if (n > 1) ws.mergeCells(r, 1, r, n); };
      const put = (r, v, font, align, h) => { const c = ws.getCell(r, 1); c.value = v; c.font = { name: FONT, ...font }; c.alignment = { vertical: 'middle', ...align }; mergeRow(r); if (h) ws.getRow(r).height = h; };
      put(1, 'ASAHI Life', { size: 20, bold: true, color: { argb: NAVY } }, { horizontal: 'left' }, 30);
      put(2, 'ASAHI ACADEMY · TRAINING DELIVERY', { size: 10, bold: true, color: { argb: GREY } }, { horizontal: 'left' }, 18);
      for (let i = 1; i <= n; i++) ws.getCell(2, i).border = { bottom: { style: 'medium', color: { argb: NAVY } } };
      put(4, sh.title.toUpperCase(), { size: 16, bold: true, color: { argb: NAVY } }, { horizontal: 'center' }, 34);
      let r = 5;
      (sh.info || []).forEach(([k, v]) => {
        const c = ws.getCell(r, 1);
        c.value = { richText: [{ text: k + ': ', font: { name: FONT, size: 10, bold: true, color: { argb: NAVY } } }, { text: String(v), font: { name: FONT, size: 10 } }] };
        c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }; mergeRow(r);
        const tw = sh.cols.reduce((a, x) => a + (x.width || 14), 0);
        ws.getRow(r).height = Math.max(18, Math.ceil((k.length + String(v).length + 2) / (tw * 0.95)) * 16); r++;
      });
      r++;
      const hr = r;
      const hrow = ws.getRow(hr); hrow.height = 30;
      sh.cols.forEach((c, i) => {
        const cell = hrow.getCell(i + 1);
        cell.value = c.header;
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } }, left: { style: 'thin', color: { argb: 'FF3A5C99' } }, right: { style: 'thin', color: { argb: 'FF3A5C99' } } };
      });
      r++;
      const body = (row, idx, bold) => {
        const rr = ws.getRow(r);
        sh.cols.forEach((c, i) => {
          const cell = rr.getCell(i + 1);
          const v = c.key === '#' ? (bold ? '' : idx + 1) : row[c.key];
          cell.value = v === undefined || v === null ? '' : v;
          if (c.text) cell.numFmt = '@';
          const col = c.color && v ? c.color(v) : null;
          cell.font = { name: FONT, size: 10, bold: !!bold || !!col, ...(col ? { color: { argb: col } } : {}) };
          cell.alignment = { horizontal: c.align || 'left', vertical: 'middle', wrapText: true };
          cell.border = { top: { style: 'thin', color: { argb: LINE } }, bottom: { style: 'thin', color: { argb: LINE } }, left: { style: 'thin', color: { argb: LINE } }, right: { style: 'thin', color: { argb: LINE } } };
          if (bold) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EAF6' } };
          else if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        });
        rr.height = 22; r++;
      };
      sh.rows.forEach((row, i) => body(row, i));
      if (sh.total) body(sh.total, 0, true);
      ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: n } };
      ws.views = [{ state: 'frozen', ySplit: hr, showGridLines: false }];
      ws.pageSetup.printTitlesRow = `${hr}:${hr}`;
      // Chữ ký
      r += 1;
      if (n >= 2 && !sh.nosign) {
        const mid = Math.max(1, Math.floor(n / 2));
        const sign = (c1, c2, row, text, font) => { if (c2 > c1) ws.mergeCells(row, c1, row, c2); const c = ws.getCell(row, c1); c.value = text; c.font = { name: FONT, size: 10, ...font }; c.alignment = { horizontal: 'center' }; };
        sign(mid + 1, n, r, `TP. Hồ Chí Minh, ngày ${dd} tháng ${mm} năm ${nowVN.getFullYear()}`, { italic: true });
        r++;
        sign(1, mid, r, 'NGƯỜI LẬP BIỂU', { bold: true, color: { argb: NAVY } });
        sign(mid + 1, n, r, 'QUẢN LÝ TRAINING DELIVERY', { bold: true, color: { argb: NAVY } });
        r++;
        sign(1, mid, r, '(Ký, ghi rõ họ tên)', { italic: true, color: { argb: GREY }, size: 9 });
        sign(mid + 1, n, r, '(Ký, ghi rõ họ tên)', { italic: true, color: { argb: GREY }, size: 9 });
        ws.getRow(r + 3).height = 18;
        const nm = ws.getCell(r + 4, 1); nm.value = `Người lập: ${me.full_name || me.email || ''} · Xuất lúc ${stamp}`;
        nm.font = { name: FONT, size: 9, italic: true, color: { argb: GREY } }; mergeRow(r + 4);
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const STATUS_COLOR = (v) => (/^Đúng giờ|^Có mặt/.test(v) ? 'FF1B7F4B' : v === 'Muộn' ? 'FFC76A00' : v === 'Vắng' ? 'FFC0392B' : null);

  async function viewReports(el) {
    const classes = await q(db.from('classes').select('id, name').order('created_at', { ascending: false }));
    const tabs = [['att', 'Điểm danh theo lớp'], ['stu', 'Học viên theo lớp']].concat(me.role === 'admin' ? [['hrs', 'Giờ dạy giảng viên']] : []);
    el.innerHTML = `<div class="card rep"><h2>Báo cáo</h2>
      <div class="seg" id="rtabs">${tabs.map(([k, l], i) => `<button type="button" data-t="${k}"${i ? '' : ' class="on"'}>${l}</button>`).join('')}</div>
      <div id="rpane" class="rpane"></div></div>`;
    const pane = $('#rpane', el);
    const show = (k) => {
      $$('#rtabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.t === k));
      pane.innerHTML = ''; pane.dataset.k = k;
      if (k === 'att') attendancePane(pane, classes);
      else if (k === 'stu') studentClassCard(pane, classes);
      else teachHoursCard(pane);
    };
    $$('#rtabs button', el).forEach((b) => { b.onclick = () => show(b.dataset.t); });
    show('att');
  }

  function attendancePane(pane, classes) {
    pane.innerHTML = `<p class="muted small">Điểm danh từng học viên, từng buổi. File Excel gồm 2 trang: "Chi tiết" và "Tổng hợp" (số buổi đúng giờ, muộn, vắng).</p>
      <div class="rgrid">
        <div class="rfull"><label>Lớp</label><select id="rc"><option value="">Tất cả các lớp${me.role === 'teacher' ? ' của tôi' : ''}</option>
          ${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div><label>Từ ngày học</label><input id="rf" type="date"></div>
        <div><label>Đến ngày học</label><input id="rt" type="date"></div></div>
      <div class="ract"><button class="btn pink" id="go">Xuất Excel</button></div>`;
    $('#go', pane).onclick = (e) => busy(e.target, () => exportReport($('#rc', pane).value ? [$('#rc', pane).value] : null, $('#rf', pane).value, $('#rt', pane).value));
  }

  // Báo cáo học viên - lớp: học viên đã học / đang học những lớp nào. Lọc theo thời gian, mã lớp, giảng viên, học viên
  async function studentClassCard(el, classes) {
    const box = document.createElement('div');
    const teachers = await q(db.rpc('list_teachers')).catch(() => []);
    if (el.dataset.k && el.dataset.k !== 'stu') return;
    box.innerHTML = `<p class="muted small">Học viên đã học và đang học những lớp nào. Mỗi mục lọc đều có thể để trống.</p>
      <div class="rgrid"><div><label>Mã lớp</label><select id="sc_c"><option value="">Tất cả</option>${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div><label>Giảng viên</label><select id="sc_t"><option value="">Tất cả</option>${teachers.map((t) => `<option value="${esc(String(t.email).toLowerCase())}">${esc(t.full_name || t.email)}</option>`).join('')}</select></div>
        <div><label>Từ ngày</label><input id="sc_f" type="date"></div>
        <div><label>Đến ngày</label><input id="sc_to" type="date"></div>
        <div><label>Học viên (mã hoặc tên)</label><input id="sc_s" placeholder="Để trống = tất cả"></div>
        <div><label>Trạng thái lớp</label><select id="sc_st"><option value="">Tất cả</option><option value="act">Đang học</option><option value="done">Đã học xong</option></select></div>
        <div><label>Sắp xếp theo</label><select id="sc_o"><option value="stu">Học viên</option><option value="cls">Mã lớp</option><option value="tch">Giảng viên</option><option value="time">Thời gian</option></select></div></div>
      <div class="ract"><button class="btn pink" id="sc_go">Xuất Excel</button></div>
      <div class="small muted" style="margin-top:8px">Lớp tính vào khoảng thời gian nếu có buổi học nằm trong khoảng đó.</div>`;
    el.appendChild(box);
    $('#sc_go', box).onclick = (e) => busy(e.target, async () => {
      const f = $('#sc_f', box).value, t = $('#sc_to', box).value, cid = $('#sc_c', box).value, tem = $('#sc_t', box).value;
      const key = norm($('#sc_s', box).value.trim()), stf = $('#sc_st', box).value, ord = $('#sc_o', box).value;
      let cq = db.from('classes').select('id, name, start_date, ended_at, class_type_id, class_types(name)'); if (cid) cq = cq.eq('id', cid);
      const cls = await q(cq);
      if (!cls.length) throw new Error('Không có lớp nào');
      const sessions = await fetchAll(() => { const b = db.from('class_sessions').select('id, class_id, session_date, teacher_email, opened_at, node_id, counts_absent').order('id'); return cid ? b.eq('class_id', cid) : b; });
      const roster = await fetchAll(() => { const b = db.from('class_students').select('class_id, node_ids, added_at, students(code, full_name, title)').order('class_id').order('student_code'); return cid ? b.eq('class_id', cid) : b; });
      const att = await fetchAll(() => { const b = db.from('attendance').select('session_id, student_code, class_sessions!inner(class_id)').order('id'); return cid ? b.eq('class_sessions.class_id', cid) : b; });
      const tname = {}; teachers.forEach((x) => { tname[String(x.email).toLowerCase()] = x.full_name || x.email; });
      const attCnt = {}; const sc = {}; sessions.forEach((x) => { sc[x.id] = x.class_id; });
      att.forEach((a) => { const k = sc[a.session_id] + '|' + a.student_code; attCnt[k] = (attCnt[k] || 0) + 1; });
      const today = vnToday();
      const nodesAll = await loadNodes(); const attKey = new Set(att.map((a) => a.session_id + '|' + a.student_code));
      const info = {};
      cls.forEach((c) => {
        const ss = sessions.filter((x) => x.class_id === c.id);
        const dates = ss.map((x) => x.session_date).filter(Boolean).sort();
        const first = dates[0] || c.start_date || '', last = dates[dates.length - 1] || '';
        info[c.id] = { c, ss, first, last, active: classIsActive(c, last, today),
          teachers: Array.from(new Set(ss.map((x) => String(x.teacher_email || '').toLowerCase()).filter(Boolean))),
          inRange: !f && !t ? true : ss.some((x) => x.session_date && (!f || x.session_date >= f) && (!t || x.session_date <= t)) };
      });
      const rows = [];
      roster.forEach((r) => {
        const st = r.students; if (!st) return;
        const i = info[r.class_id]; if (!i || !i.inRange) return;
        if (tem && !i.teachers.includes(tem)) return;
        if (stf && (stf === 'act') !== i.active) return;
        if (key && !norm(st.code + ' ' + st.full_name).includes(key)) return;
        const cn = i.c.class_type_id ? nodesAll.filter((n) => n.class_type_id === i.c.class_type_id) : [];
        const mine = i.ss.filter((x) => (!cn.length || inNodes(r.node_ids, x.node_id, cn)) && !(r.added_at && x.opened_at && x.opened_at < r.added_at && !attKey.has(x.id + '|' + st.code)));
        const mineIds = new Set(mine.map((x) => x.id));
        const present = att.filter((a) => a.student_code === st.code && mineIds.has(a.session_id)).length;
        const absentN = mine.filter((x) => x.opened_at && x.counts_absent !== false && !attKey.has(x.id + '|' + st.code)).length;
        rows.push({ code: st.code, name: st.full_name, title: st.title || '', cls: i.c.name, type: i.c.class_types?.name || '',
          tch: i.teachers.map((e) => tname[e] || e).join(', '), first: i.first, last: i.last,
          status: i.c.ended_at ? 'Đã kết thúc' : i.active ? 'Đang học' : 'Đã học xong', active: i.active,
          present: present + '/' + mine.length, absent: absentN });
      });
      if (!rows.length) throw new Error('Không có dữ liệu phù hợp bộ lọc');
      const vi = (a, b) => String(a).localeCompare(String(b), 'vi');
      const cmp = { stu: (a, b) => vi(a.name, b.name) || vi(a.cls, b.cls), cls: (a, b) => vi(a.cls, b.cls) || vi(a.name, b.name),
        tch: (a, b) => vi(a.tch, b.tch) || vi(a.cls, b.cls) || vi(a.name, b.name), time: (a, b) => vi(b.first, a.first) || vi(a.cls, b.cls) || vi(a.name, b.name) }[ord];
      rows.sort(cmp);
      const by = {};
      rows.forEach((r) => { const o = by[r.code] = by[r.code] || { code: r.code, name: r.name, title: r.title, act: [], done: [] }; (r.active ? o.act : o.done).push(r.cls); });
      const sum = Object.values(by).sort((a, b) => vi(a.name, b.name)).map((o) => ({ code: o.code, name: o.name, title: o.title,
        nact: o.act.length, ndone: o.done.length, act: o.act.join(', '), done: o.done.join(', ') }));
      const fmt = (d) => (d ? fmtDate(d) : '');
      const filt = [];
      if (cid) filt.push('Lớp ' + (cls[0] ? cls[0].name : ''));
      if (tem) filt.push('Giảng viên ' + (tname[tem] || tem));
      if (f || t) filt.push(`Thời gian ${f ? fmtDate(f) : '...'} → ${t ? fmtDate(t) : '...'}`);
      if (key) filt.push('Học viên "' + $('#sc_s', box).value.trim() + '"');
      if (stf) filt.push(stf === 'act' ? 'Đang học' : 'Đã học xong');
      const infoRows = [['Bộ lọc', filt.join(' · ') || 'Tất cả'], ['Số học viên', String(sum.length)], ['Số lượt tham gia lớp', String(rows.length)]];
      const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await saveXlsx(`BaoCao_HocVien_Lop_${d}.xlsx`, [
        { name: 'Học viên - Lớp', title: 'Danh sách học viên theo lớp', info: infoRows,
          rows: rows.map((r) => ({ ...r, first: fmt(r.first), last: fmt(r.last) })),
          cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Mã HV', key: 'code', width: 13, align: 'center' }, { header: 'Họ và tên', key: 'name', width: 28 },
            { header: 'Chức danh', key: 'title', width: 18 }, { header: 'Mã lớp', key: 'cls', width: 26 }, { header: 'Khoá học', key: 'type', width: 16 },
            { header: 'Giảng viên', key: 'tch', width: 24 }, { header: 'Từ ngày', key: 'first', width: 12, align: 'center' }, { header: 'Đến ngày', key: 'last', width: 12, align: 'center' },
            { header: 'Trạng thái', key: 'status', width: 13, align: 'center' }, { header: 'Có mặt', key: 'present', width: 9, align: 'center' }, { header: 'Vắng', key: 'absent', width: 8, align: 'center' }] },
        { name: 'Tổng hợp học viên', title: 'Tổng hợp theo học viên', info: infoRows, rows: sum,
          cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Mã HV', key: 'code', width: 13, align: 'center' }, { header: 'Họ và tên', key: 'name', width: 28 },
            { header: 'Chức danh', key: 'title', width: 18 }, { header: 'Số lớp đang học', key: 'nact', width: 11, align: 'center' }, { header: 'Số lớp đã học xong', key: 'ndone', width: 12, align: 'center' },
            { header: 'Lớp đang học', key: 'act', width: 40 }, { header: 'Lớp đã học xong', key: 'done', width: 40 }] },
      ]);
      toast(`Đã xuất ${sum.length} học viên, ${rows.length} lượt tham gia lớp`, 'ok');
    });
  }

  // Báo cáo giờ dạy giảng viên theo tháng (admin). Ca sáng = 4 giờ, chiều/tối = 5 giờ. Chỉ tính buổi đã mở điểm danh.
  function teachHoursCard(el) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const box = document.createElement('div');
    box.innerHTML = `<p class="muted small">Giờ dạy của giảng viên theo tháng. Chỉ tính buổi đã mở điểm danh: ca sáng 4 giờ, ca chiều và tối 5 giờ.</p>
      <div class="rgrid"><div><label>Tháng</label><input id="thm" type="month" value="${ym}"></div></div>
      <div class="ract"><button class="btn pink" id="thgo">Xem báo cáo</button></div>
      <div id="thout" style="margin-top:12px"></div>`;
    el.appendChild(box);
    let data = null, month = ym;
    const SH = { sang: 'Sáng', chieu: 'Chiều', toi: 'Tối' };
    const load = () => busy($('#thgo', box), async () => {
      month = $('#thm', box).value || ym;
      const [y, m] = month.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      data = await q(db.rpc('teaching_hours', { p_from: `${month}-01`, p_to: `${month}-${String(last).padStart(2, '0')}` }));
      draw();
    });
    const draw = () => {
      const out = $('#thout', box);
      if (!data.length) { out.innerHTML = '<p class="muted">Tháng này chưa có buổi dạy nào được mở điểm danh.</p>'; return; }
      const by = {};
      data.forEach((r) => { const k = r.teacher_email || '-'; (by[k] = by[k] || { name: r.teacher_name, rows: [] }).rows.push(r); });
      const list = Object.values(by).map((t) => ({ ...t, hours: t.rows.reduce((a, r) => a + r.hours, 0) })).sort((a, b) => b.hours - a.hours);
      const max = list[0].hours, total = list.reduce((a, t) => a + t.hours, 0);
      out.innerHTML = `<div class="small" style="margin-bottom:8px">Tổng: <b>${data.length}</b> buổi · <b>${total}</b> giờ · <b>${list.length}</b> giảng viên</div>
        <div class="tbl-wrap"><table><tr><th>#</th><th>Giảng viên</th><th>Số buổi</th><th>Tổng giờ</th><th style="min-width:120px"></th></tr>
        ${list.map((t, i) => `<tr><td>${i + 1}</td><td><b>${esc(t.name)}</b></td><td>${t.rows.length}</td><td><b>${t.hours}</b></td>
          <td><div class="bar"><i style="width:${Math.round(100 * t.hours / max)}%"></i></div></td></tr>`).join('')}</table></div>
        ${list.map((t) => `<details style="margin-top:8px"><summary><b>${esc(t.name)}</b> · ${t.rows.length} buổi · ${t.hours} giờ</summary>
          <div class="tbl-wrap"><table><tr><th>Ngày</th><th>Ca</th><th>Lớp</th><th>Buổi</th><th>Giờ</th></tr>
          ${t.rows.map((r) => `<tr><td>${fmtDate(r.session_date)}</td><td>${SH[r.shift] || ''}</td><td>${esc(r.class_name)}</td><td>${r.session_no}</td><td>${r.hours}</td></tr>`).join('')}</table></div></details>`).join('')}
        <div style="margin-top:12px"><button class="btn ghost" id="thx">Xuất Excel</button></div>`;
      $('#thx', box).onclick = (e) => busy(e.target, async () => {
        const sum = list.map((t) => ({ name: t.name, email: t.rows[0].teacher_email, n: t.rows.length, h: t.hours }));
        const detail = list.flatMap((t) => t.rows.map((r) => ({ name: t.name, date: fmtDate(r.session_date), shift: SH[r.shift] || '', cls: r.class_name, no: r.session_no, content: r.content || '', h: r.hours })));
        const info = [['Kỳ báo cáo', `Tháng ${month.slice(5)}/${month.slice(0, 4)}`], ['Quy ước giờ dạy', 'Ca sáng 4 giờ · ca chiều 5 giờ · ca tối 5 giờ (chỉ tính buổi đã mở điểm danh)']];
        await saveXlsx(`BaoCao_GioDay_${month}.xlsx`, [
          { name: 'Tổng hợp', title: `Báo cáo giờ dạy giảng viên tháng ${month.slice(5)}/${month.slice(0, 4)}`, info, rows: sum, total: { name: 'TỔNG CỘNG', n: data.length, h: total },
            cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Giảng viên', key: 'name', width: 30 }, { header: 'Email', key: 'email', width: 34 },
              { header: 'Số buổi', key: 'n', width: 11, align: 'center' }, { header: 'Tổng giờ', key: 'h', width: 11, align: 'center' }] },
          { name: 'Chi tiết', title: `Chi tiết giờ dạy tháng ${month.slice(5)}/${month.slice(0, 4)}`, info, rows: detail, total: { name: 'TỔNG CỘNG', h: total },
            cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Giảng viên', key: 'name', width: 28 }, { header: 'Ngày dạy', key: 'date', width: 13, align: 'center' },
              { header: 'Ca', key: 'shift', width: 9, align: 'center' }, { header: 'Lớp', key: 'cls', width: 26 }, { header: 'Buổi', key: 'no', width: 7, align: 'center' },
              { header: 'Nội dung', key: 'content', width: 30 }, { header: 'Giờ', key: 'h', width: 8, align: 'center' }] },
        ]);
      });
    };
    $('#thgo', box).onclick = load;
  }

  async function exportReport(classIds, from, to) {
    let cq = db.from('classes').select('id, name, start_date, class_type_id, class_types(name, max_absent)').order('name');
    if (classIds) cq = cq.in('id', classIds);
    const classes = await q(cq);
    if (!classes.length) throw new Error('Không có lớp nào để xuất');
    const ids = classes.map((c) => c.id);

    const sessions = await fetchAll(() => { let b = db.from('class_sessions').select('*').order('id'); if (classIds) b = b.in('class_id', ids); return b; });
    const roster = await fetchAll(() => { let b = db.from('class_students').select('class_id, node_ids, added_at, students(*)').order('class_id').order('student_code'); if (classIds) b = b.in('class_id', ids); return b; });
    const allNodes = await loadNodes();
    const att = await fetchAll(() => { let b = db.from('attendance').select('*, class_sessions!inner(class_id)').order('id'); if (classIds) b = b.in('class_sessions.class_id', ids); return b; });
    const amap = {}; att.forEach((a) => { amap[a.session_id + '|' + a.student_code] = a; });

    const detail = []; const summary = {};
    const modCodes = new Set();
    for (const c of classes) {
      const cn = c.class_type_id ? allNodes.filter((n) => n.class_type_id === c.class_type_id) : [];
      const modOf = (sx) => { const n = cn.find((x) => x.id === sx.node_id); return n ? (n.parent_id ? cn.find((x) => x.id === n.parent_id) || n : n) : null; };
      const learnTxt = (ids) => (!ids || !ids.length ? 'Tất cả' : ids.map((id) => { const n = cn.find((x) => x.id === id); if (!n) return ''; const p = n.parent_id ? cn.find((x) => x.id === n.parent_id) : null; return p ? p.code + '-' + n.code : n.code; }).filter(Boolean).join(', '));
      const sess = sessions.filter((x) => x.class_id === c.id)
        .filter((x) => (!from || (x.session_date && x.session_date >= from)) && (!to || (x.session_date && x.session_date <= to)))
        .sort((a, b) => a.session_no - b.session_no);
      const stu = roster.filter((r) => r.class_id === c.id && r.students)
        .sort((a, b) => String(a.students.full_name).localeCompare(String(b.students.full_name), 'vi'));
      for (const r of stu) {
        const st = r.students; const key = c.id + '|' + st.code;
        const row = summary[key] = { 'Lớp': c.name, 'Mã HV': st.code, 'Họ tên': st.full_name, 'Chức danh': st.title || '', 'Module học': cn.length ? learnTxt(r.node_ids) : '',
          'Đúng giờ': 0, 'Muộn': 0, 'Vắng': 0, 'Vắng không tính': 0, 'Chưa mở': 0, mods: {} };
        for (const sx of sess) {
          if (cn.length && !inNodes(r.node_ids, sx.node_id, cn)) continue; // buổi ngoài module của học viên
          const a = amap[sx.id + '|' + st.code];
          if (!a && r.added_at && sx.opened_at && sx.opened_at < r.added_at) continue; // buổi mở trước ngày vào lớp
          let status = lateInfo(sx, c, a);
          const free = status === 'Vắng' && sx.counts_absent === false;
          if (free) status = 'Vắng (không tính)';
          const sKey = status.startsWith('Có mặt') ? 'Đúng giờ' : free ? 'Vắng không tính' : status;
          if (row[sKey] !== undefined) row[sKey]++;
          const m = modOf(sx);
          if (m) { modCodes.add(m.code); const e = row.mods[m.code] || (row.mods[m.code] = { used: 0, max: m.max_absent == null ? 1 : m.max_absent }); if (status === 'Vắng') e.used++; }
          const nd = cn.find((x) => x.id === sx.node_id);
          detail.push({
            'Lớp': c.name, 'Khoá học': c.class_types?.name || '', 'Module': nd ? nodeCode(c.class_types?.name, nd, cn) : '', 'Buổi': sx.session_no, 'Nội dung': sx.content || '',
            'Ngày học': fmtDate(sx.session_date), 'Ca': sx.shift ? SHIFT_LABEL[sx.shift] : '', 'Mã HV': st.code, 'Họ tên': st.full_name,
            'Chức danh': st.title || '', 'Trạng thái': status,
            'Giờ điểm danh': a ? fmtTime(a.checked_at) : '', 'Hình thức': a ? (a.source === 'manual' ? 'Giảng viên điểm danh' : 'QR') : '',
            'Vị trí': !a || a.source === 'manual' ? '' : a.out_of_area === true ? 'Ngoài khu vực' : a.out_of_area === false ? 'Trong khu vực' : 'Chưa đối chiếu',
          });
        }
        if (!cn.length) row.legacyMax = c.class_types?.max_absent;
      }
    }
    if (!detail.length) throw new Error('Không có dữ liệu trong khoảng này');
    const mcodes = Array.from(modCodes).sort();
    const sum = Object.values(summary).map((r) => {
      const opened = r['Đúng giờ'] + r['Muộn'] + r['Vắng'];
      const over = [], full = [];
      Object.entries(r.mods).forEach(([k, e]) => { if (e.used > e.max) over.push(`${k} ${e.used}/${e.max}`); else if (e.used >= 1 && e.used === e.max) full.push(`${k} ${e.used}/${e.max}`); });
      if (r.legacyMax != null && r['Vắng'] > r.legacyMax) over.push(`Cả khoá ${r['Vắng']}/${r.legacyMax}`);
      const out = { ...r, 'Tỷ lệ có mặt': opened ? Math.round(((r['Đúng giờ'] + r['Muộn']) / opened) * 100) + '%' : '',
        'Cảnh báo vắng': [over.length ? 'Vượt ' + over.join(', ') : '', full.length ? 'Hết lượt ' + full.join(', ') : ''].filter(Boolean).join(' · ') };
      mcodes.forEach((k) => { const e = r.mods[k]; out['mod_' + k] = e ? `${e.used}/${e.max}` : '—'; });
      return out;
    });
    const names = classes.map((c) => c.name).join(', ');
    const info = [['Lớp', classes.length > 3 ? `${classes.length} lớp` : names],
      ['Kỳ báo cáo', from || to ? `${from ? fmtDate(from) : '...'} → ${to ? fmtDate(to) : '...'}` : 'Toàn bộ thời gian'],
      ['Quy ước', 'Đúng giờ · Muộn · Vắng (chỉ tính buổi đã mở điểm danh). Vắng tính riêng từng module: số vắng/số buổi được vắng. Không tính buổi MOF, buổi ngoài module học viên học, và buổi mở trước ngày học viên vào lớp.']];
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await saveXlsx(`BaoCao_DiemDanh_${d}.xlsx`, [
      { name: 'Tổng hợp', title: 'Báo cáo tổng hợp điểm danh', info, rows: sum,
        cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Lớp', key: 'Lớp', width: 24 }, { header: 'Mã HV', key: 'Mã HV', width: 13, align: 'center' },
          { header: 'Họ và tên', key: 'Họ tên', width: 28 }, { header: 'Chức danh', key: 'Chức danh', width: 20 }, { header: 'Module học', key: 'Module học', width: 16, align: 'center' },
          { header: 'Đúng giờ', key: 'Đúng giờ', width: 10, align: 'center' }, { header: 'Muộn', key: 'Muộn', width: 9, align: 'center' },
          { header: 'Vắng (tính)', key: 'Vắng', width: 11, align: 'center' },
          ...mcodes.map((k) => ({ header: `Vắng ${k} (đã vắng/được vắng)`, key: 'mod_' + k, width: 16, align: 'center' })),
          { header: 'Vắng không tính (MOF)', key: 'Vắng không tính', width: 14, align: 'center' }, { header: 'Chưa mở', key: 'Chưa mở', width: 10, align: 'center' },
          { header: 'Tỷ lệ có mặt', key: 'Tỷ lệ có mặt', width: 12, align: 'center' }, { header: 'Cảnh báo', key: 'Cảnh báo vắng', width: 34 }] },
      { name: 'Chi tiết', title: 'Chi tiết điểm danh từng buổi', info, rows: detail,
        cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Lớp', key: 'Lớp', width: 24 }, { header: 'Khoá học', key: 'Khoá học', width: 16 }, { header: 'Module', key: 'Module', width: 18 },
          { header: 'Buổi', key: 'Buổi', width: 7, align: 'center' }, { header: 'Nội dung', key: 'Nội dung', width: 28 }, { header: 'Ngày học', key: 'Ngày học', width: 12, align: 'center' },
          { header: 'Ca', key: 'Ca', width: 9, align: 'center' }, { header: 'Mã HV', key: 'Mã HV', width: 13, align: 'center' }, { header: 'Họ và tên', key: 'Họ tên', width: 26 },
          { header: 'Chức danh', key: 'Chức danh', width: 18 }, { header: 'Trạng thái', key: 'Trạng thái', width: 20, color: STATUS_COLOR },
          { header: 'Giờ điểm danh', key: 'Giờ điểm danh', width: 20, align: 'center' }, { header: 'Hình thức', key: 'Hình thức', width: 20 }, { header: 'Vị trí', key: 'Vị trí', width: 16, color: (v) => (v === 'Ngoài khu vực' ? 'FFC0392B' : v === 'Trong khu vực' ? 'FF1B7F4B' : null) }] },
    ]);
    toast('Đã xuất file Excel', 'ok');
  }

  // ================================================================ ADMIN: khoá học
  async function viewTypes(el) {
    el.innerHTML = '<div class="card" id="newbox"></div><div class="card"><h2>Khoá học</h2><p class="muted small">Mỗi khoá học có các module (cấp 2, ví dụ M1, M2) và nhóm (cấp 3, nếu có). Mỗi buổi thuộc đúng một module hoặc nhóm. Mỗi module có số buổi được vắng riêng.</p><div id="t">Đang tải...</div></div>';
    const types = await q(db.from('class_types').select('id, name, description, class_type_sessions(id, session_no, content, day_no, shift, node_id, counts_absent)').order('name'));
    const nodes = await loadNodes();
    $('#t').innerHTML = types.length ? types.map((t) => {
      const tn = nodes.filter((n) => n.class_type_id === t.id);
      const l2 = tn.filter((n) => !n.parent_id);
      const ss = t.class_type_sessions.slice().sort((a, b) => a.session_no - b.session_no);
      const rows = ss.map((x, i) => {
        const n = tn.find((y) => y.id === x.node_id); const par = n && n.parent_id ? tn.find((y) => y.id === n.parent_id) : null;
        const c2 = par ? par : n; const c2code = c2 ? t.name + '-' + c2.code : '—';
        const c3code = par ? t.name + '-' + par.code + '-' + n.code : '—';
        return `<tr><td class="n">${i + 1}</td><td class="cd">${esc(t.name)}</td><td class="cd">${esc(c2code)}</td><td class="cd">${esc(c3code)}</td><td class="n">Buổi ${x.session_no}</td><td class="ct">${esc(x.content)}</td></tr>`; }).join('');
      return `<div style="border-top:1px solid var(--line);padding:10px 0">
        <div class="row between"><b>${esc(t.name)}</b> <span><span class="badge">${ss.length} buổi</span> <button class="btn sm ghost" data-edit="${t.id}">Sửa</button> <button class="btn sm danger" data-del="${t.id}">Xóa</button></span></div>
        <div class="muted small">${esc(t.description || '')}</div>
        <div class="tbl-wrap"><table class="ctab"><tr><th>STT</th><th>Cấp 1</th><th>Cấp 2</th><th>Cấp 3</th><th>Buổi</th><th>Nội dung</th></tr>${rows}</table></div>
        <div class="cset"><b class="small">Cài đặt chung: số buổi được vắng</b>
          <div class="row" style="margin-top:6px">${l2.map((n) => `<label class="cset-i">${esc(n.code)} <input type="number" min="0" value="${n.max_absent ?? ''}" data-mx="${n.id}"></label>`).join('')}</div></div></div>`; }).join('')
      : '<p class="muted">Chưa có khoá học nào.</p>';
    $$('[data-mx]', el).forEach((i) => { i.onchange = () => busy(null, async () => {
      await q(db.from('course_nodes').update({ max_absent: i.value === '' ? null : Number(i.value) }).eq('id', i.dataset.mx)); toast('Đã lưu số buổi được vắng', 'ok'); }); });
    $$('[data-del]', el).forEach((b) => { b.onclick = () => {
      if (!confirm('Xóa khoá học này? Các lớp đã tạo vẫn giữ nguyên.')) return;
      busy(b, async () => { await q(db.from('class_types').delete().eq('id', b.dataset.del)); render(); }); }; });
    const openEditor = (t) => { courseEditor($('#newbox'), t, nodes.filter((n) => t && n.class_type_id === t.id), () => render()); $('#newbox').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $$('[data-edit]', el).forEach((b) => { b.onclick = () => openEditor(types.find((x) => x.id === b.dataset.edit)); });
    courseEditor($('#newbox'), null, [], () => render());
  }

  // Bảng soạn khoá học: tạo mới hoặc sửa/thêm buổi (khoá đã có: chỉ thêm buổi, không xoá buổi; chỉ áp dụng cho lớp tạo sau)
  function courseEditor(box, t, tn, done) {
    const isNew = !t;
    const byId = (id) => tn.find((n) => n.id === id);
    let rows; const mx = {};
    if (isNew) rows = [{ c2: 'M1', c3: '', day: 1, shift: 'sang', counts: true, content: '' }, { c2: 'M1', c3: '', day: 1, shift: 'chieu', counts: true, content: '' }];
    else {
      tn.filter((n) => !n.parent_id).forEach((n) => { mx[n.code.toUpperCase()] = n.max_absent; });
      rows = t.class_type_sessions.slice().sort((a, b) => a.session_no - b.session_no).map((x) => {
        const n = byId(x.node_id); const par = n && n.parent_id ? byId(n.parent_id) : null;
        return { id: x.id, session_no: x.session_no, c2: par ? par.code : (n ? n.code : 'M1'), c3: par ? n.code : '', day: x.day_no || '', shift: x.shift || 'sang', counts: x.counts_absent !== false, content: x.content };
      });
    }
    box.innerHTML = `<h3>${isNew ? 'Tạo khoá học mới' : 'Sửa khoá ' + esc(t.name)}</h3>
      ${isNew ? '' : '<p class="small muted">Chỉ áp dụng cho lớp tạo sau này. Buổi đã có không xoá được; muốn thêm buổi hoặc module thì bấm "+ Thêm buổi".</p>'}
      <div class="cform"><div><label>Mã khoá học (cấp 1)</label><input id="ce-name" placeholder="VD: LPFC-F" value="${isNew ? '' : esc(t.name)}"${isNew ? '' : ' disabled'}></div>
        <div><label>Mô tả</label><input id="ce-desc" value="${isNew ? '' : esc(t.description || '')}"></div></div>
      <div class="tbl-wrap"><table class="ctab ced"><thead><tr><th>STT</th><th>Cấp 1</th><th>Cấp 2</th><th>Cấp 3</th><th>Ngày</th><th>Ca</th><th>Nội dung</th><th>Tính vắng</th><th></th></tr></thead><tbody id="ce-body"></tbody></table></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm ghost" id="ce-add">+ Thêm buổi</button><button type="button" class="btn sm ghost" id="ce-add5">+ Thêm 5 buổi</button></div>
      <div class="cset" id="ce-set"></div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn pink" id="ce-save">Lưu khoá học</button>${isNew ? '' : '<button type="button" class="btn ghost" id="ce-cancel">Hủy</button>'}</div>`;
    const name = () => $('#ce-name', box).value.trim().toUpperCase();
    const drawRows = () => {
      $('#ce-body', box).innerHTML = rows.map((r, i) => `<tr data-i="${i}"><td class="n">${i + 1}</td><td class="cd"><span class="ce-n">${esc(name() || '—')}</span></td>
        <td><input data-f="c2" value="${esc(r.c2)}" style="width:72px"></td><td><input data-f="c3" value="${esc(r.c3)}" style="width:84px" placeholder="—"></td>
        <td><input data-f="day" type="number" min="1" value="${r.day}" style="width:60px"></td>
        <td><select data-f="shift"><option value="sang"${r.shift === 'sang' ? ' selected' : ''}>Sáng</option><option value="chieu"${r.shift === 'chieu' ? ' selected' : ''}>Chiều</option><option value="toi"${r.shift === 'toi' ? ' selected' : ''}>Tối</option></select></td>
        <td><input data-f="content" value="${esc(r.content)}"></td><td class="n"><input type="checkbox" data-f="counts"${r.counts ? ' checked' : ''} style="width:auto;min-height:0"></td>
        <td>${r.id ? '' : '<button type="button" class="btn sm ghost" data-rm>✕</button>'}</td></tr>`).join('');
      drawSet();
    };
    const drawSet = () => {
      const keys = []; rows.forEach((r) => { const k = r.c2.trim(); if (k && !keys.some((x) => x.toUpperCase() === k.toUpperCase())) keys.push(k); });
      $('#ce-set', box).innerHTML = `<b class="small">Cài đặt chung: số buổi được vắng</b><div class="row" style="margin-top:6px">${keys.map((k) => {
        const v = mx[k.toUpperCase()] === undefined ? 1 : mx[k.toUpperCase()];
        return `<label class="cset-i">${esc(k)} <input type="number" min="0" data-mx="${esc(k)}" value="${v === null ? '' : v}"></label>`; }).join('') || '<span class="small muted">Nhập cấp 2 ở bảng trên</span>'}</div>`;
    };
    $('#ce-name', box).oninput = () => { $$('.ce-n', box).forEach((e) => { e.textContent = name() || '—'; }); };
    $('#ce-set', box).addEventListener('input', (e) => { const i = e.target; if (i.dataset.mx !== undefined) mx[i.dataset.mx.toUpperCase()] = i.value === '' ? null : Number(i.value); });
    const tb = $('#ce-body', box);
    tb.addEventListener('input', (e) => {
      const el = e.target; const tr = el.closest('tr'); if (!tr || !el.dataset.f) return;
      rows[+tr.dataset.i][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.f === 'c2') drawSet();
    });
    tb.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; rows.splice(+b.closest('tr').dataset.i, 1); drawRows(); });
    const addRow = () => {
      const p = rows[rows.length - 1] || { c2: 'M1', c3: '', day: 1, shift: 'chieu', counts: true };
      rows.push({ c2: p.c2, c3: '', day: p.shift === 'sang' ? p.day : (Number(p.day) || 0) + 1, shift: p.shift === 'sang' ? 'chieu' : 'sang', counts: true, content: '' });
    };
    $('#ce-add', box).onclick = () => { addRow(); drawRows(); };
    $('#ce-add5', box).onclick = () => { for (let i = 0; i < 5; i++) addRow(); drawRows(); };
    if ($('#ce-cancel', box)) $('#ce-cancel', box).onclick = () => done();
    drawRows();
    $('#ce-save', box).onclick = (e) => busy(e.target, async () => {
      const nm = name(); if (!nm) throw new Error('Nhập mã khoá học');
      if (!rows.length) throw new Error('Cần ít nhất 1 buổi');
      rows.forEach((r, i) => {
        if (!r.c2.trim()) throw new Error(`Dòng ${i + 1}: thiếu cấp 2 (ví dụ M1)`);
        if (!r.content.trim()) throw new Error(`Dòng ${i + 1}: thiếu nội dung`);
        if (!(Number(r.day) >= 1)) throw new Error(`Dòng ${i + 1}: ngày học phải từ 1`);
      });
      let course = t;
      if (isNew) course = await q(db.from('class_types').insert({ name: nm, description: $('#ce-desc', box).value.trim() || null }).select().single());
      else await q(db.from('class_types').update({ description: $('#ce-desc', box).value.trim() || null }).eq('id', t.id));
      const cur = await q(db.from('course_nodes').select('*').eq('class_type_id', course.id));
      const find2 = (c) => cur.find((n) => !n.parent_id && n.code.toUpperCase() === c.trim().toUpperCase());
      const keys2 = []; rows.forEach((r) => { if (!keys2.some((k) => k.toUpperCase() === r.c2.trim().toUpperCase())) keys2.push(r.c2.trim()); });
      const new2 = keys2.filter((k) => !find2(k));
      if (new2.length) cur.push(...await q(db.from('course_nodes').insert(new2.map((k, i) => ({ class_type_id: course.id, code: k, sort_no: cur.filter((n) => !n.parent_id).length + i + 1, max_absent: mx[k.toUpperCase()] === undefined ? 1 : mx[k.toUpperCase()] }))).select()));
      for (const k of keys2) { const n = find2(k); const v = mx[k.toUpperCase()] === undefined ? 1 : mx[k.toUpperCase()]; if (n.max_absent !== v) await q(db.from('course_nodes').update({ max_absent: v }).eq('id', n.id)); }
      const find3 = (c2, c3) => cur.find((n) => n.parent_id === find2(c2).id && n.code.toUpperCase() === c3.trim().toUpperCase());
      const new3 = []; rows.forEach((r) => { const c3 = r.c3.trim(); if (c3 && !find3(r.c2, c3) && !new3.some((x) => x.p === find2(r.c2).id && x.code.toUpperCase() === c3.toUpperCase())) new3.push({ p: find2(r.c2).id, code: c3 }); });
      if (new3.length) cur.push(...await q(db.from('course_nodes').insert(new3.map((x, i) => ({ class_type_id: course.id, parent_id: x.p, code: x.code, sort_no: cur.filter((n) => n.parent_id === x.p).length + i + 1, max_absent: null }))).select()));
      const leaf = (r) => (r.c3.trim() ? find3(r.c2, r.c3) : find2(r.c2)).id;
      let next = Math.max(0, ...rows.filter((r) => r.id).map((r) => r.session_no)) ;
      for (const r of rows) {
        const body = { content: r.content.trim(), day_no: Number(r.day), shift: r.shift, counts_absent: !!r.counts, node_id: leaf(r) };
        if (r.id) await q(db.from('class_type_sessions').update(body).eq('id', r.id));
        else { next += 1; await q(db.from('class_type_sessions').insert({ ...body, class_type_id: course.id, session_no: next })); }
      }
      toast(isNew ? 'Đã lưu khoá học' : 'Đã lưu. Chỉ áp dụng cho lớp tạo sau này', 'ok'); done();
    });
  }

  // ================================================================ ADMIN: nhân sự
  async function viewStaff(el) {
    el.innerHTML = `<div class="card"><h2>Admin & Giảng viên</h2>
      <details class="more"><summary>Cách mời người mới</summary><p class="muted small">Thêm email vào danh sách rồi gửi <b>mã mời</b> cho người đó. Họ bấm "Đăng ký tài khoản?" ở màn hình đăng nhập, nhập email + mã mời để tạo tài khoản.</p></details>
      <form id="sf" class="cform"><div class="f-full"><label>Email</label><input id="se" type="email" required></div>
        <div><label>Họ tên</label><input id="sn" required></div>
        <div><label>Quyền</label><select id="sr"><option value="teacher">Giảng viên</option><option value="admin">Admin</option></select></div>
        <div class="f-full"><button class="btn pink">Thêm vào danh sách</button></div></form></div>
      <div class="card"><div id="t">Đang tải...</div></div><div id="tamgr"></div>`;
    viewTAs($('#tamgr')).catch((e) => toast(errMsg(e), 'bad'));
    const allowed = await q(db.from('allowed_staff').select('*').order('email'));
    const profs = await q(db.from('profiles').select('id, email, role').in('role', ['admin', 'teacher']));
    const pmap = {}; profs.forEach((p) => { pmap[p.email.toLowerCase()] = p; });
    $('#t').innerHTML = `<div class="plist" style="margin-top:0">${allowed.map((a) => { const p = pmap[a.email.toLowerCase()]; return `<div class="pi"><div class="pi-main"><b>${esc(a.full_name)}</b> <span class="badge">${ROLE_LABEL[a.role]}</span>
        <div class="small muted" style="word-break:break-all">${esc(a.email)}</div>
        <div class="pi-st">Mã mời: <code>${esc(a.invite_code)}</code> ${p ? '<span class="badge ok">Đã đăng ký</span>' : '<span class="badge gray">Chưa đăng ký</span>'}</div></div>
        <div class="pi-act">${p && p.id !== me.id ? `<button class="btn sm danger" data-deluser="${p.id}">Xóa tài khoản</button>` : ''}
          ${p ? '' : `<button class="btn sm danger" data-delmail="${esc(a.email)}">Xóa</button>`}</div></div>`; }).join('')}</div>`;
    $('#sf').onsubmit = (e) => {
      e.preventDefault();
      busy($('#sf button'), async () => {
        await q(db.from('allowed_staff').insert({ email: $('#se').value.trim().toLowerCase(), full_name: $('#sn').value.trim(), role: $('#sr').value }));
        toast('Đã thêm', 'ok'); render();
      });
    };
    $$('[data-deluser]', el).forEach((b) => { b.onclick = () => {
      if (!confirm('Xóa tài khoản này? Các lớp họ đã tạo vẫn giữ lại nhưng không còn người phụ trách.')) return;
      busy(b, async () => { await q(db.rpc('admin_delete_user', { p_user: b.dataset.deluser })); toast('Đã xóa tài khoản', 'ok'); render(); }); }; });
    $$('[data-delmail]', el).forEach((b) => { b.onclick = () => busy(b, async () => {
      await q(db.from('allowed_staff').delete().eq('email', b.dataset.delmail)); render(); }); });
  }

  // ================================================================ QUẢN LÝ TRỢ GIẢNG (admin)
  async function viewTAs(el) {
    if (me.role !== 'admin') return;
    el.innerHTML = `<div class="card"><h2>Trợ giảng</h2>
        <p class="muted small">Học viên được nâng lên trợ giảng vẫn điểm danh bình thường và có thêm tab <b>Lịch dạy</b>, mở được mã QR ở các buổi được phân công. Mỗi lớp có 1 trợ giảng, chọn trong trang lớp. Nếu giảng viên và trợ giảng ở xa nhau (trên 200 m) thì giảng viên được ưu tiên: giảng viên chưa mở QR thì trợ giảng mới mở được.</p>
        <label>Thêm trợ giảng: tìm học viên (mã hoặc họ tên)</label>
        <input id="tq" placeholder="Gõ mã hoặc tên..." autocomplete="off">
        <div class="pick" id="tl"><div class="small muted" style="padding:10px">Đang tải...</div></div></div>
      <div class="card"><h3 id="th">Danh sách trợ giảng</h3><div id="tt" class="plist"></div></div>`;
    const stu = await fetchAll(() => db.from('students').select('code, full_name, title').order('full_name').order('code'));
    const load = async () => {
      const tas = await q(db.rpc('list_tas'));
      const cl = await q(db.from('classes').select('name, ta_email, ended_at').not('ta_email', 'is', null));
      const isTA = new Set(tas.map((t) => t.code));
      $('#th').textContent = `Danh sách trợ giảng (${tas.length})`;
      $('#tt').innerHTML = tas.length ? tas.map((t) => {
        const mine = cl.filter((c) => String(c.ta_email).toLowerCase() === String(t.email).toLowerCase() && !c.ended_at);
        return `<div class="pi"><div class="pi-main"><b>${esc(t.full_name)}</b><div class="small muted">${esc(t.code)}${t.title ? ' · ' + esc(t.title) : ''}</div>
          <div class="pi-st">${mine.length ? mine.map((c) => `<span class="badge">${esc(c.name)}</span>`).join(' ') : '<span class="small muted">Chưa phụ trách lớp nào</span>'}${t.has_account ? '' : '<span class="badge gray">Chưa đăng nhập lần nào</span>'}</div></div>
          <div class="pi-act"><button class="btn sm danger" data-rmta="${esc(t.code)}">Hạ xuống học viên</button></div></div>`; }).join('')
        : '<p class="muted">Chưa có trợ giảng nào.</p>';
      $$('[data-rmta]', el).forEach((b) => { b.onclick = () => {
        if (!confirm('Hạ trợ giảng này xuống học viên? Họ sẽ bị gỡ khỏi các lớp và các buổi đã được gán.')) return;
        busy(b, async () => { await q(db.rpc('set_ta', { p_code: b.dataset.rmta, p_on: false })); toast('Đã hạ xuống học viên', 'ok'); load(); }); }; });
      const draw = () => {
        const k = norm($('#tq').value);
        const list = stu.filter((s) => !k || norm(s.code + ' ' + s.full_name).includes(k));
        const shown = list.slice(0, 40);
        $('#tl').innerHTML = shown.length ? shown.map((s) => `<div class="pk"><span style="flex:1;min-width:0"><b>${esc(s.full_name)}</b><small>${esc(s.code)}${s.title ? ' · ' + esc(s.title) : ''}</small></span>
          ${isTA.has(s.code) ? '<span class="badge ok">Đã là trợ giảng</span>' : `<button class="btn sm pink" data-addta="${esc(s.code)}" type="button">Nâng lên trợ giảng</button>`}</div>`).join('')
          + (list.length > 40 ? `<div class="small muted" style="padding:8px 10px">Còn ${list.length - 40} kết quả, hãy gõ thêm để lọc.</div>` : '')
          : '<div class="small muted" style="padding:10px">Không tìm thấy học viên.</div>';
        $$('[data-addta]', el).forEach((b) => { b.onclick = () => busy(b, async () => { await q(db.rpc('set_ta', { p_code: b.dataset.addta, p_on: true })); toast('Đã nâng lên trợ giảng', 'ok'); load(); }); });
      };
      $('#tq').oninput = draw; draw();
    };
    await load();
  }

  // Ô ngày hiển thị dạng dd/mm/yy (ô chọn ngày gốc của trình duyệt vẫn dùng để chọn, nhưng được ẩn đi)
  function enhanceDates(root) {
    $$('input[type="date"]:not(.dn)', root || document).forEach((inp) => {
      inp.classList.add('dn');
      const w = document.createElement('span'); w.className = 'dwrap';
      const t = document.createElement('span'); t.className = 'dtxt';
      const upd = () => { t.textContent = inp.value ? fmtDate(inp.value) : 'dd/mm/yy'; t.classList.toggle('ph', !inp.value); };
      inp.parentNode.insertBefore(w, inp); w.append(t, inp); upd();
      inp.addEventListener('input', upd); inp.addEventListener('change', upd);
    });
  }
  new MutationObserver(() => enhanceDates()).observe(document.body, { childList: true, subtree: true });

  boot();
})();
