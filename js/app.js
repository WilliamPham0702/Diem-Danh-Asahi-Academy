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
  const fmtDate = (s) => (s ? String(s).split('-').reverse().join('/') : '');
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
  };
  function errMsg(e) {
    const m = (e && e.message) || String(e);
    for (const k of Object.keys(ERR)) if (m.includes(k)) return ERR[k];
    if (/Database error saving new user/i.test(m)) return 'Thông tin đăng ký không hợp lệ. Hãy liên hệ giảng viên hoặc admin.';
    if (/Invalid login/i.test(m)) return 'Sai mã học viên/email hoặc mật khẩu';
    if (/already registered/i.test(m)) return 'Tài khoản này đã tồn tại, hãy đăng nhập';
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
    admin: [['schedule', 'Lịch dạy'], ['classes', 'Lớp học'], ['roster', 'Học viên'], ['reports', 'Báo cáo'], ['types', 'Loại lớp'],
      ['staff', 'Nhân sự'], ['account', 'Tài khoản']],
  };
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
    if (me.must_change_password && !skipPw) { viewForceChange(); return; }
    if (!location.hash || location.hash === '#') nav(TABS[me.role][0][0]); else render();
    if (me.role === 'student') checkReminder();
  }

  // ---------------------------------------------------------------- thương hiệu (logo lấy từ asahilife.com)
  const LOGO_URL = 'https://static-prod.asahilife.com/logo/main-logo-secondary.webp?v=1.0.9';
  const SYMBOL_URL = 'https://static-prod.asahilife.com/logo/ASAHI_SYMBOL.svg?v=1.0.9';
  // Logo trắng, dùng trên nền navy. Nếu ảnh không tải được thì hiện chữ thay thế.
  function logoHtml(h) {
    return `<img class="logo" src="${LOGO_URL}" alt="Asahi Life" height="${h}" onerror="this.outerHTML='<span class=&quot;logo-fb&quot;>Asahi Life</span>'">`;
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
      <div class="auth-div"><i></i><img src="${SYMBOL_URL}" alt="" height="28" onerror="this.style.display='none'"><i></i></div>
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
  const APP_VERSION = '2026.11.28-27';
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
          let { error } = await db.auth.signInWithPassword({ email, password });
          // Lần đầu: học viên chưa có tài khoản, mật khẩu = mã học viên -> tự tạo tài khoản mặc định
          if (error && !isEmail && /Invalid login/i.test(error.message) && normCode(password) === code) {
            const r = await db.auth.signUp({ email, password: code, options: { data: { student_code: code } } });
            if (r.error) {
              if (/already registered/i.test(r.error.message)) throw new Error('Sai mã học viên hoặc mật khẩu. Nếu quên mật khẩu, bấm "Quên mật khẩu?" bên dưới.');
              throw r.error;
            }
            if (!r.data.session) throw new Error('Chưa đăng nhập được: cần tắt "Confirm email" trong Supabase (xem README).');
            error = null;
          }
          if (error) throw error;
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
        msg.textContent = 'Đã đặt lại. Hãy đăng nhập bằng mã học viên, mật khẩu cũng là mã học viên.';
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
    $('#later').onclick = () => { skipPw = true; location.hash = '#/' + TABS[me.role][0][0]; enter(); };
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
    let route = parts[0] || TABS[me.role][0][0];
    const param = parts[1];
    const allowed = TABS[me.role].map((t) => t[0]).concat(me.role === 'student' ? [] : ['class', 'session', 'qr']);
    if (!allowed.includes(route)) { nav(TABS[me.role][0][0]); return; }

    if (route === 'qr') {
      viewQR(param, () => seq !== renderSeq).catch((e) => { console.error(e); toast(errMsg(e), 'err'); });
      return;
    }

    const tabKey = SUBROUTES[route] || route;
    app.innerHTML = `
      <div class="topbar">
        <div class="brand">${logoHtml(26)}</div>
        <div class="who"><span class="name">${esc(me.full_name || me.email)}</span>
          <span class="badge">${ROLE_LABEL[me.role]}</span>
          <button class="btn ghost sm" id="logout">Thoát</button></div>
      </div>
      <div class="tabs">${TABS[me.role].map(([k, l]) =>
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
      '新しい朝がはじまる, một buổi sáng mới bắt đầu. Hôm nay bạn sẽ giỏi hơn hôm qua!'],
    chieu: ['Chúc bạn một buổi chiều tràn đầy năng lượng: kiên trì thêm chút nữa, thành quả đang ở rất gần.',
      'Giữa ngày là lúc khẳng định bản lĩnh. Chúc bạn tập trung, vui và thật hiệu quả!',
      'Mỗi buổi học là một viên gạch xây nên phiên bản xuất sắc nhất của bạn. Chúc bạn một buổi chiều thật đáng giá!'],
    toi: ['Chúc bạn một buổi tối bình yên, nhìn lại những gì đã học và tự hào về bản thân nhé.',
      'Ngày hôm nay bạn đã cố gắng rất nhiều. Chúc bạn một buổi tối thật nhẹ nhõm và một giấc ngủ ngon!',
      'Sau mỗi ngày nỗ lực là một buổi tối xứng đáng nghỉ ngơi. Chúc bạn tối nay thật ấm áp!'],
  };
  function wishNow() {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours();
    const part = h < 12 ? 'sang' : h < 18 ? 'chieu' : 'toi';
    const word = { sang: 'buổi sáng', chieu: 'buổi chiều', toi: 'buổi tối' }[part];
    const list = WISHES[part];
    return { word, text: list[Math.floor(Math.random() * list.length)] };
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
    if (!box || !box.isConnected) return;
    const fmtRange = (c) => c.first_session ? `${fmtDate(c.first_session)} → ${fmtDate(c.last_session)}` : '(chưa có lịch)';
    const group = (list) => {
      const g = {}; list.forEach((c) => { (g[c.type_name] = g[c.type_name] || []).push(c); });
      return Object.keys(g).sort((a, b) => a.localeCompare(b, 'vi')).map((k) => [k, g[k]]);
    };
    const joined = rows.filter((c) => c.joined);
    const open = rows.filter((c) => !c.joined);
    const card = (c, isOpen) => {
      const pct = c.total_sessions ? Math.round(100 * c.attended / c.total_sessions) : 0;
      return `<div class="ccard ${isOpen ? '' : 'go'}" ${isOpen ? '' : `data-go="1" role="button" tabindex="0"`}>
      <div class="cc-top"><span class="cc-name">${esc(c.name)}</span>${isOpen ? '' : '<span class="badge ok">Đã tham gia</span>'}</div>
      <div class="cc-meta"><div><span>Thời gian</span>${esc(fmtRange(c))}</div>
        ${c.location ? `<div><span>Địa điểm</span>${esc(c.location)}</div>` : ''}
        ${(c.teachers || []).length ? `<div><span>Giảng viên</span>${esc(c.teachers.join(', '))}</div>` : ''}</div>
      ${isOpen ? `<button class="btn pink" data-reg="${c.id}" style="width:100%;margin-top:10px">Đăng ký lớp này</button>`
        : `<div class="cc-prog"><div class="bar"><i style="width:${pct}%"></i></div><div class="small">Đã điểm danh <b>${c.attended}/${c.total_sessions}</b> buổi · <u>Bấm để điểm danh</u></div></div>`}
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
          <div class="small" style="margin-top:6px">Loại lớp: ${esc(c.type_name)}<br>Thời gian học: ${esc(fmtRange(c))}<br>Địa điểm: ${esc(c.location || '(chưa cập nhật)')}<br>Giảng viên: ${esc((c.teachers || []).join(', ') || '(chưa phân công)')}</div></div>
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

    function showResult(r) {
      const cls = { ok: 'ok', already: 'info', closed: 'warn', device_mismatch: 'warn', device_used: 'warn' }[r.status] || 'bad';
      const title = { ok: r.late ? 'Đã điểm danh (đến muộn)' : 'Điểm danh thành công', already: 'Đã điểm danh' }[r.status] || 'Chưa điểm danh được';
      let extra = '';
      if (r.status === 'ok') {
        extra = `<p class="small">Lớp: <b>${esc(r.class_name)}</b><br>Buổi ${esc(r.session_no)}: ${esc(r.content || '')}<br>
          Học viên: <b>${esc(r.student_name)}</b> (${esc(r.student_code)})<br>Thời gian: <b>${esc(fmtTime(r.checked_at))}</b></p>`;
      }
      $('#result').innerHTML = `<div class="result ${cls}"><h3>${title}</h3><div>${esc(r.status === 'ok' ? '' : r.message)}</div>${extra}</div>`;
      $('#start').textContent = r.status === 'ok' ? 'Quét buổi khác' : 'Quét lại';
      $('#start').classList.remove('hide');
    }

    async function submit(token) {
      $('#result').innerHTML = '<p class="muted">Đang ghi nhận...</p>';
      const { data, error } = await db.rpc('check_in', { p_token: token, p_device: deviceId() });
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

  function mapRow(row) {
    const out = { code: '', full_name: '', title: '' };
    for (const key of Object.keys(row)) {
      const k = norm(key); const v = String(row[key] ?? '').trim();
      if (!v) continue;
      if (k.includes('email') || k.includes('mail')) continue; // không lưu email
      else if (k.includes('quanly') || k.includes('manager')) continue; // không lưu cấp quản lý (kể cả cột gộp "cấp quản lý và chức danh")
      else if (k.includes('chucdanh') || k.includes('chucvu') || k === 'title') out.title = v;
      else if (['mahocvien', 'mahv', 'mshv', 'ma', 'code', 'mahocvien'].includes(k) || k.includes('mahocvien')) out.code = normCode(v);
      else if (k.includes('tenhocvien') || k.includes('hoten') || k.includes('hovaten') || k === 'ten' || k === 'name' || k === 'fullname') out.full_name = v;
    }
    return out;
  }

  async function readStudentsFile(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    const seen = new Set(); const ok = []; const bad = []; let skipped = 0;
    rows.forEach((r, i) => {
      if (!Object.values(r).some((v) => String(v).trim())) return; // dòng trống
      const s = mapRow(r);
      if (!s.code || !s.full_name) { bad.push(i + 2); return; }
      if (seen.has(s.code)) { skipped++; return; }
      seen.add(s.code); ok.push(s);
    });
    // File lỗi thì không cho tiếp tục (không tạo lớp, không nhập)
    if (!ok.length) throw new Error('File không có học viên hợp lệ. Cần các cột "Mã học viên" và "Họ và tên" (dòng đầu là tiêu đề cột).');
    if (bad.length) throw new Error(`File lỗi: dòng ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? '...' : ''} thiếu mã học viên hoặc họ tên. Hãy sửa file rồi tải lại.`);
    return { rows: ok, skipped };
  }

  async function importStudents(file) {
    const { rows, skipped } = await readStudentsFile(file);
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await db.from('students').upsert(rows.slice(i, i + 400), { onConflict: 'code' });
      if (error) throw error;
    }
    return { codes: rows.map((r) => r.code), count: rows.length, skipped };
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

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Mã học viên', 'Họ và tên', 'Chức danh'],
      ['000000089', 'Nguyễn Văn A', 'Agency Leader'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh sách');
    XLSX.writeFile(wb, 'Mau_danh_sach_hoc_vien.xlsx');
  }

  // ================================================================ GIẢNG VIÊN: danh sách lớp
  async function viewClasses(el) {
    el.innerHTML = '<div class="card"><div class="row between"><h2>Lớp học</h2><button class="btn pink" id="new">+ Tạo lớp</button></div><div id="t" class="muted">Đang tải...</div></div>';
    $('#new').onclick = openCreateClass;
    const rows = await q(db.from('classes')
      .select('id, name, start_date, graduation_date, class_types(name), class_students(count), class_sessions(count)')
      .order('created_at', { ascending: false }));
    $('#t').outerHTML = rows.length ? `<div class="tbl-wrap"><table>
      <tr><th>Tên lớp</th><th>Loại lớp</th><th>Ngày bắt đầu</th><th>Ngày tốt nghiệp</th><th>Học viên</th><th>Số buổi</th><th></th></tr>
      ${rows.map((c) => `<tr class="rowlink" data-open="${c.id}"><td><a href="#/class/${c.id}"><b>${esc(c.name)}</b></a></td><td>${esc(c.class_types?.name || '')}</td>
        <td>${esc(fmtDate(c.start_date))}</td><td>${esc(fmtDate(c.graduation_date))}</td><td>${c.class_students?.[0]?.count ?? 0}</td>
        <td>${c.class_sessions?.[0]?.count ?? 0}</td>
        <td class="act"><a class="btn sm" href="#/class/${c.id}">Mở lớp</a></td></tr>`).join('')}</table></div>`
      : '<p class="muted">Chưa có lớp nào. Bấm "Tạo lớp" để bắt đầu.</p>';
    $$('[data-open]', el).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a')) nav('class/' + tr.dataset.open); }; });
  }

  async function openCreateClass() {
    const types = await q(db.from('class_types').select('id, name, class_type_sessions(count)').order('name'));
    const sessList = await q(db.from('class_type_sessions').select('class_type_id, day_no'));
    if (!types.length) { toast('Chưa có loại lớp nào. Admin cần tạo loại lớp trước.', 'err'); return; }
    const today = new Date().toISOString().slice(0, 10);
    modal(`<h2>Tạo lớp</h2>
      <form id="cf">
        <label>Tên lớp</label><input id="cn" required placeholder="VD: LPFC-HCM-20261201" style="text-transform:uppercase" autocapitalize="characters">
        <div class="grid2">
          <div><label>Loại lớp</label><select id="ct">${types.map((t) =>
            `<option value="${t.id}">${esc(t.name)} (${t.class_type_sessions?.[0]?.count ?? 0} buổi)</option>`).join('')}</select></div>
          <div><label>Ngày học đầu tiên</label><input id="cd" type="date" value="${today}" required></div>
        </div>
        <label>Ngày tốt nghiệp <span class="muted small">(tự tính, có thể chọn ngày khác)</span></label><input id="cg" type="date" required>
        <label>Địa điểm học</label><input id="cl" placeholder="VD: Phòng 301, Asahi Life - 123 Nguyễn Huệ, Q.1">
        <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="ce" style="width:auto"> Mở đăng ký cho học viên tự đăng ký lớp này</label>
        <label>Danh sách học viên (file Excel)</label><input id="cx" type="file" accept=".xlsx,.xls,.csv">
        <div class="small muted">Cột: Mã học viên, Họ và tên, Chức danh. Cột Mã học viên nên để định dạng Text để giữ số 0 ở đầu. <a href="#" id="tpl">Tải file mẫu</a></div>
        <label>Hoặc nhập thêm mã học viên đã có trong hệ thống</label>
        <textarea id="cc" placeholder="000000089, 000000090, ..."></textarea>
        <div class="row" style="margin-top:14px"><button class="btn pink" id="ok">Tạo lớp</button>
          <button type="button" class="btn ghost" id="cancel">Hủy</button></div>
      </form>`, (m, close) => {
      $('#tpl', m).onclick = (e) => { e.preventDefault(); downloadTemplate(); };
      $('#cancel', m).onclick = close;
      // Ngày tốt nghiệp mặc định = ngày học cuối của loại lớp (bỏ T7, CN), giảng viên có thể sửa
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
      $('#cd', m).onchange = autoGrad; $('#ct', m).onchange = autoGrad; autoGrad();
      $('#cf', m).onsubmit = (e) => {
        e.preventDefault();
        busy($('#ok', m), async () => {
          let codes = parseCodes($('#cc', m).value);
          const f = $('#cx', m).files[0];
          if (f) { const r = await importStudents(f); codes = codes.concat(r.codes); if (r.skipped) toast(`Bỏ qua ${r.skipped} dòng thiếu thông tin`); }
          codes = Array.from(new Set(codes));
          if (!codes.length && !confirm('Chưa có học viên nào (chưa chọn file Excel). Vẫn tạo lớp? Sau đó có thể thêm học viên trong lớp.')) return;
          const id = await q(db.rpc('create_class', {
            p_name: $('#cn', m).value.trim().toUpperCase(), p_type: $('#ct', m).value, p_start: $('#cd', m).value,
            p_codes: codes, p_grad: $('#cg', m).value || null,
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
    const roster = await q(db.from('class_students').select('student_code, students(*)').eq('class_id', id));
    const att = sessions.length ? await fetchAll(() => db.from('attendance')
      .select('session_id, student_code, checked_at, source, late').in('session_id', sessions.map((s) => s.id)).order('id')) : [];
    const profs = roster.length ? await fetchAll(() => db.from('profiles').select('student_code, device_id')
      .eq('role', 'student').order('id')) : [];
    const hasDevice = new Set(profs.filter((p) => p.device_id).map((p) => p.student_code));

    const perSession = {}; const perStudent = {};
    att.forEach((a) => {
      perSession[a.session_id] = (perSession[a.session_id] || 0) + 1;
      perStudent[a.student_code] = (perStudent[a.student_code] || 0) + 1;
    });
    const total = roster.length;
    const attSet = new Set(att.map((a) => a.session_id + '|' + a.student_code));
    const attMap = {}; att.forEach((a) => { attMap[a.session_id + '|' + a.student_code] = a; });
    const maxAbsent = cls.class_types?.max_absent;
    const absent = {}; roster.forEach((r) => { absent[r.student_code] = absentCount(sessions, r.student_code, attSet); });
    const teachers = await q(db.rpc('list_teachers'));
    const warned = maxAbsent == null ? [] : roster.filter((r) => absent[r.student_code] > maxAbsent);
    roster.sort((a, b) => String(a.students?.full_name).localeCompare(String(b.students?.full_name), 'vi'));

    el.innerHTML = `
      <p><a href="#/classes">&larr; Danh sách lớp</a></p>
      <div class="card">
        <div><h2>${esc(cls.name)}</h2>
          <span class="muted">${esc(cls.class_types?.name || '')} · bắt đầu ${esc(fmtDate(cls.start_date))}${cls.graduation_date ? ' · tốt nghiệp ' + esc(fmtDate(cls.graduation_date)) : ''}</span></div>
        <div class="grid2" style="margin-top:10px">
          <div><label>Địa điểm học</label><input id="loc" value="${esc(cls.location || '')}" placeholder="Nhập địa điểm học"></div>
          <div><label>Đăng ký</label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="oen" style="width:auto"${cls.open_enrollment ? ' checked' : ''}> Mở đăng ký cho học viên</label></div></div>
        <div class="btnrow"><button class="btn ghost" id="exp">Xuất Excel</button>
          <button class="btn ghost" id="add">+ Thêm học viên</button>
          <button class="btn danger" id="del">Xóa lớp</button></div>
      </div>
      ${warned.length ? `<div class="card" style="border-color:#f1c2c8;background:#fff6f7">
        <h3 style="color:var(--bad)">⚠ Cảnh báo: ${warned.length} học viên vắng quá ${maxAbsent} buổi</h3>
        <div class="small">${warned.map((r) => `<b>${esc(r.students?.full_name || r.student_code)}</b> (${esc(r.student_code)}): vắng ${absent[r.student_code]} buổi`).join('<br>')}</div></div>` : ''}
      <div class="card"><h3>Các buổi học</h3>
        <div class="tbl-wrap"><table>
          <tr><th>Buổi</th><th>Nội dung</th><th>Ngày học</th><th>Ca</th><th>Giảng viên dạy</th><th>Trạng thái</th><th>Có mặt</th><th></th></tr>
          ${sessions.map((s) => `<tr>
            <td>${s.session_no}</td><td>${esc(s.content)}</td>
            <td><input type="date" value="${s.session_date || ''}" data-date="${s.id}" style="width:150px"></td>
            <td>${s.shift ? SHIFT_LABEL[s.shift] : ''}</td>
            <td><select data-teacher="${s.id}" style="min-width:150px"><option value="">(Chưa gán)</option>${teachers.map((t) => `<option value="${esc(t.email)}"${t.email === String(s.teacher_email || '').toLowerCase() ? ' selected' : ''}>${esc(t.full_name || t.email)}${t.has_account ? '' : ' (chưa tạo TK)'}</option>`).join('')}</select></td>
            <td>${s.closed ? '<span class="badge gray">Đã đóng</span>' : s.opened_at ? '<span class="badge ok">Đã mở</span>' : '<span class="badge warn">Chưa mở</span>'}</td>
            <td>${perSession[s.id] || 0}/${total}</td>
            <td class="act">
              ${qrButtons(s, true)}
              <a class="btn sm" href="#/session/${s.id}">Chi tiết</a></td></tr>`).join('')}
        </table></div></div>
      <div class="card"><h3>Học viên (${total})</h3>
        <div class="small muted" style="margin-bottom:6px"><span class="sc ok inl">✓</span> đúng giờ &nbsp;<span class="sc late inl">M</span> muộn &nbsp;<span class="sc abs inl">V</span> vắng &nbsp;<span class="sc none inl">·</span> chưa học &nbsp;(kéo ngang để xem các buổi sau)</div>
        <div class="tbl-wrap"><table>
          <tr><th>Mã</th><th>Họ tên</th><th>Chức danh</th><th>Có mặt</th><th>Vắng</th><th></th><th>Từng buổi</th></tr>
          ${roster.map((r) => { const s = r.students || {}; return `<tr>
            <td>${esc(r.student_code)}</td><td>${esc(s.full_name)}</td>
            <td>${esc(s.title)}</td>
            <td>${perStudent[r.student_code] || 0}/${sessions.length}</td>
            <td>${absent[r.student_code] > 0 ? `<span class="badge ${maxAbsent != null && absent[r.student_code] > maxAbsent ? 'bad' : 'gray'}">${absent[r.student_code]}</span>` : '0'}</td>
            <td class="act">${hasDevice.has(r.student_code) ? `<button class="btn sm ghost" data-reset="${esc(r.student_code)}">Đặt lại thiết bị</button>` : ''}
              <button class="btn sm ghost" data-resetpw="${esc(r.student_code)}">Đặt lại MK</button>
              <button class="btn sm danger" data-rm="${esc(r.student_code)}">Xóa</button></td>
            <td>${sessGrid(sessions, attMap, r.student_code)}</td></tr>`; }).join('')}
        </table></div></div>`;

    $('#loc').onchange = () => busy(null, async () => { await q(db.from('classes').update({ location: $('#loc').value.trim() || null }).eq('id', id)); toast('Đã lưu địa điểm', 'ok'); });
    $('#oen').onchange = () => busy(null, async () => { await q(db.from('classes').update({ open_enrollment: $('#oen').checked }).eq('id', id)); toast($('#oen').checked ? 'Đã mở đăng ký cho học viên' : 'Đã đóng đăng ký', 'ok'); });
    $('#exp').onclick = (e) => busy(e.target, () => exportReport([id]));
    $('#add').onclick = () => openAddStudents(id);
    $('#del').onclick = (e) => {
      if (!confirm('Xóa lớp này cùng toàn bộ dữ liệu điểm danh? Không thể hoàn tác.')) return;
      busy(e.target, async () => { await q(db.from('classes').delete().eq('id', id)); toast('Đã xóa lớp', 'ok'); nav('classes'); });
    };
    $$('[data-date]', el).forEach((i) => { i.onchange = () => busy(null, async () => {
      await q(db.from('class_sessions').update({ session_date: i.value || null }).eq('id', i.dataset.date)); toast('Đã lưu ngày học', 'ok'); }); });
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
    modal(`<h2>Thêm học viên vào lớp</h2>
      <form id="af">
        <label>File Excel danh sách</label><input id="ax" type="file" accept=".xlsx,.xls,.csv">
        <div class="small muted"><a href="#" id="tpl">Tải file mẫu</a></div>
        <label>Hoặc nhập mã học viên đã có trong hệ thống</label>
        <textarea id="ac" placeholder="000000089, 000000090, ..."></textarea>
        <div class="row" style="margin-top:14px"><button class="btn pink" id="ok">Thêm</button>
          <button type="button" class="btn ghost" id="cancel">Hủy</button></div>
      </form>`, (m, close) => {
      $('#tpl', m).onclick = (e) => { e.preventDefault(); downloadTemplate(); };
      $('#cancel', m).onclick = close;
      $('#af', m).onsubmit = (e) => {
        e.preventDefault();
        busy($('#ok', m), async () => {
          const existing = new Set((await q(db.from('class_students').select('student_code').eq('class_id', classId))).map((x) => x.student_code));
          let codes = parseCodes($('#ac', m).value);
          let dup = 0;
          const f = $('#ax', m).files[0];
          if (f) {
            const { rows } = await readStudentsFile(f); // file lỗi thì báo lỗi, không thêm gì
            const fresh = rows.filter((r) => !existing.has(r.code));
            dup += rows.length - fresh.length; // đã có trong lớp: không nhập lại
            for (let i = 0; i < fresh.length; i += 400) {
              const { error } = await db.from('students').upsert(fresh.slice(i, i + 400), { onConflict: 'code' });
              if (error) throw error;
            }
            codes = codes.concat(fresh.map((r) => r.code));
          }
          codes = Array.from(new Set(codes));
          const already = codes.filter((c) => existing.has(c)); dup += already.length;
          codes = codes.filter((c) => !existing.has(c));
          if (!codes.length) {
            if (dup) { close(); toast(`Tất cả ${dup} học viên đã có trong lớp, không thêm lại`, 'ok'); return; }
            throw new Error('Chưa có mã học viên nào');
          }
          const miss = await missingCodes(codes);
          const ok = codes.filter((c) => !miss.includes(c));
          if (ok.length) {
            const { error } = await db.from('class_students').upsert(
              ok.map((c) => ({ class_id: classId, student_code: c })), { onConflict: 'class_id,student_code', ignoreDuplicates: true });
            if (error) throw error;
          }
          close();
          toast(`Đã thêm ${ok.length} học viên${dup ? `, bỏ qua ${dup} học viên đã có trong lớp` : ''}`, 'ok');
          if (miss.length) toast(`Không tìm thấy mã: ${miss.slice(0, 8).join(', ')}`, 'err');
          render();
        });
      };
    });
  }

  const SHIFT_LABEL = { sang: 'Sáng', chieu: 'Chiều' };
  // Số buổi vắng = buổi đã mở điểm danh mà học viên không có bản ghi nào (buổi Thi MOF không tính)
  // Ô trạng thái từng buổi của 1 học viên: ✓ đúng giờ (xanh) / M muộn (cam) / V vắng (đỏ) / · chưa học
  function sessGrid(sessions, attMap, code) {
    return `<div class="sgrid">${sessions.map((s) => {
      const a = attMap[s.id + '|' + code];
      let c = 'none', t = '·', tip = 'Chưa học';
      if (a) { if (a.source !== 'manual' && a.late) { c = 'late'; t = 'M'; tip = 'Muộn'; } else { c = 'ok'; t = '✓'; tip = 'Có mặt'; } }
      else if (s.opened_at) { c = s.counts_absent === false ? 'abs0' : 'abs'; t = 'V'; tip = s.counts_absent === false ? 'Vắng (không tính)' : 'Vắng'; }
      return `<span class="sc ${c}" title="Buổi ${s.session_no}: ${tip}"><i>${s.session_no}</i>${t}</span>`;
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

  async function viewSession(el, id) {
    const sess = await q(db.from('class_sessions').select('*, classes(id, name)').eq('id', id).single());
    const cls = sess.classes;
    const roster = await q(db.from('class_students').select('student_code, students(*)').eq('class_id', cls.id));
    const att = await q(db.from('attendance').select('*').eq('session_id', id));
    const map = {}; att.forEach((a) => { map[a.student_code] = a; });
    roster.sort((a, b) => String(a.students?.full_name).localeCompare(String(b.students?.full_name), 'vi'));
    const stat = { 'Đúng giờ': 0, 'Muộn': 0, 'Vắng': 0 };
    const rows = roster.map((r) => {
      const a = map[r.student_code]; const st = lateInfo(sess, cls, a);
      if (stat[st] !== undefined) stat[st]++; else if (st.startsWith('Có mặt')) stat['Đúng giờ']++;
      return { r, a, st };
    });
    const badge = (st) => (st === 'Vắng' ? 'bad' : st === 'Muộn' ? 'warn' : st === 'Chưa mở' ? 'gray' : 'ok');

    el.innerHTML = `
      <p><a href="#/class/${cls.id}">&larr; ${esc(cls.name)}</a></p>
      <div class="card"><div class="row between">
        <div><h2>Buổi ${sess.session_no}: ${esc(sess.content || '')}</h2>
          <span class="muted">${esc(fmtDate(sess.session_date))}${sess.opened_at ? ' · mở điểm danh lúc ' + esc(fmtTime(sess.opened_at)) : ''}</span></div>
        ${sess.closed ? '<span class="badge gray">Đã đóng</span> ' : ''}${qrOpenable(sess) ? `<a class="btn pink" href="#/qr/${id}">Mở QR điểm danh</a>` : (me.role === 'admin' ? `<button class="btn ghost" data-resetqr="${id}">Reset QR</button>` : '')}</div>
        <div class="stat" style="margin-top:12px">
          <div class="chip"><b>${stat['Đúng giờ']}</b>Đúng giờ</div><div class="chip"><b>${stat['Muộn']}</b>Muộn</div>
          <div class="chip"><b>${stat['Vắng']}</b>Vắng</div><div class="chip"><b>${roster.length}</b>Tổng</div></div></div>
      <div class="card"><div class="tbl-wrap"><table>
        <tr><th>Mã</th><th>Họ tên</th><th>Chức danh</th><th>Trạng thái</th><th>Giờ điểm danh</th><th></th></tr>
        ${rows.map(({ r, a, st }) => `<tr>
          <td>${esc(r.student_code)}</td><td>${esc(r.students?.full_name)}</td><td>${esc(r.students?.title)}</td>
          <td><span class="badge ${badge(st)}">${esc(st)}</span></td><td>${a ? esc(fmtTime(a.checked_at)) : ''}</td>
          <td class="act">${a ? `<button class="btn sm danger" data-undo="${a.id}">Hủy</button>`
            : `<button class="btn sm ghost" data-manual="${esc(r.student_code)}" data-name="${esc(r.students?.full_name)}">Điểm danh tay</button>`}</td></tr>`).join('')}
      </table></div></div>`;
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
    const sess = await q(db.from('class_sessions').select('id, session_no, content, closed, classes(id, name)').eq('id', id).single())
      .catch((e) => { toast(errMsg(e), 'err'); nav('classes'); return null; });
    if (!sess || isStale()) return;
    const total = (await q(db.from('class_students').select('student_code', { count: 'exact', head: false }).eq('class_id', sess.classes.id))).length;
    if (isStale()) return;
    const size = Math.floor(Math.min(window.innerWidth * 0.8, window.innerHeight * 0.5, 420));

    app.innerHTML = `
      <div class="qr-screen">
        <div class="row between" style="width:100%;max-width:700px">
          <a class="btn ghost sm" href="#/class/${sess.classes.id}">&larr; Thoát</a>
          <button class="btn sm danger" id="closeSess">Đóng điểm danh</button></div>
        <h2>${esc(sess.classes.name)}<br><small style="font-weight:400">Buổi ${sess.session_no}: ${esc(sess.content || '')}</small></h2>
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

    async function loadToken() {
      if (stopped) return;
      const { data, error } = await db.rpc('get_qr_token', { p_session: id, p_reopen: reopened });
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
      const rows = await q(db.from('attendance').select('student_name, checked_at, source').eq('session_id', id)
        .order('checked_at', { ascending: false }).limit(300)).catch(() => null);
      if (!rows) return;
      $('#cnt').textContent = rows.length;
      $('#list').innerHTML = rows.slice(0, 8).map((r) => `<div><span>${esc(r.student_name)}</span>
        <span class="muted">${esc(new Date(r.checked_at).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))}</span></div>`).join('');
    }
    function onVis() { if (!document.hidden) loadToken(); }
    document.addEventListener('visibilitychange', onVis);

    $('#closeSess').onclick = (e) => {
      if (!confirm('Đóng điểm danh buổi này? Học viên sẽ không quét được nữa.')) return;
      busy(e.target, async () => {
        explicitClosed = true;
        await q(db.rpc('close_qr', { p_session: id }));
        nav('session/' + id);
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
      const rows = await q(db.from('class_sessions')
        .select('id, session_no, content, session_date, shift, closed, opened_at, qr_reset_until, classes(id, name)')
        .eq('teacher_email', String(me.email || '').toLowerCase()).gte('session_date', ymd(gridStart)).lte('session_date', ymd(gridEnd))
        .order('session_date').order('session_no'));
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
            <div><b>${esc(r.classes?.name)}</b> · Buổi ${r.session_no}${r.shift ? ' · ' + SHIFT_LABEL[r.shift] : ''}
              <div class="small muted">${esc(r.content || '')}</div></div>
            <div class="btnrow">${r.closed ? '<span class="badge gray">Đã đóng</span>' : ''}${qrOpenable(r) ? `<a class="btn pink sm" href="#/qr/${r.id}">Mở QR điểm danh</a>` : (me.role === 'admin' ? `<button class="btn ghost sm" data-resetqr="${r.id}">Reset QR</button>` : '')}
              <a class="btn ghost sm" href="#/session/${r.id}">Chi tiết</a></div></div>`).join('')
            : '<p class="muted">Không có buổi dạy nào trong ngày này.</p>'}</div>`;
      bindResetQR(el);
      $('#pm').onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); draw(); };
      $('#nm').onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); draw(); };
      $('#tm').onclick = () => { cur = new Date(); cur.setDate(1); selected = today; draw(); };
      $$('[data-day]', el).forEach((b) => { b.onclick = () => { selected = b.dataset.day; draw(); }; });
    }
    await draw();
  }

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
    const enr = await fetchAll(() => db.from('class_students').select('student_code, classes(name, created_at)').order('student_code').order('class_id'));
    const cmap = {};
    enr.forEach((r) => { if (r.classes?.name) (cmap[r.student_code] = cmap[r.student_code] || []).push(r.classes); });
    Object.values(cmap).forEach((a) => a.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)));

    function draw() {
      const k = norm($('#search').value);
      const list = students.filter((s) => !k || norm(s.code + s.full_name).includes(k));
      const shown = list.slice(0, 300);
      $('#t').innerHTML = `<p class="muted small">${list.length} học viên${list.length > 300 ? ' (hiển thị 300 đầu tiên, hãy tìm kiếm để lọc)' : ''}</p>
        <div class="tbl-wrap"><table><tr><th>STT</th><th>Mã</th><th>Họ tên</th><th>Chức danh</th><th>Lớp đã tham gia</th><th></th></tr>
        ${shown.map((s, i) => { const p = pmap[s.code]; return `<tr>
          <td>${i + 1}</td><td>${esc(s.code)}</td><td>${esc(s.full_name)}</td><td>${esc(s.title)}</td>
          <td>${(cmap[s.code] || []).map((c) => `<span class="badge">${esc(c.name)}</span>`).join(' ') || '<span class="muted">Chưa có lớp</span>'}</td>
          <td class="act">${p ? `<button class="btn sm ghost" data-resetpw="${esc(s.code)}">Đặt lại MK</button>` : ''}
            ${p?.device_id ? `<button class="btn sm ghost" data-reset="${esc(s.code)}">Đặt lại thiết bị</button>` : ''}
            ${isAdmin && p ? `<button class="btn sm danger" data-deluser="${p.id}">Xóa tài khoản</button>` : ''}
            ${isAdmin ? `<button class="btn sm danger" data-delstu="${esc(s.code)}">Xóa HV</button>` : ''}</td></tr>`; }).join('')}
        </table></div>`;
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
        toast(`Đã nhập ${r.count} học viên${r.skipped ? `, bỏ qua ${r.skipped} dòng thiếu thông tin` : ''}`, 'ok');
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
      sc.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
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
        c.alignment = { horizontal: 'left', vertical: 'middle' }; mergeRow(r); r++;
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
      if (n >= 2) {
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
    el.innerHTML = `<div class="card" style="max-width:560px"><h2>Xuất báo cáo Excel</h2>
      <p class="muted small">File gồm 2 trang: "Chi tiết" (từng học viên, từng buổi) và "Tổng hợp" (số buổi đúng giờ, muộn, vắng).</p>
      <label>Lớp</label><select id="rc"><option value="">Tất cả các lớp${me.role === 'teacher' ? ' của tôi' : ''}</option>
        ${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div class="grid2"><div><label>Từ ngày học</label><input id="rf" type="date"></div>
        <div><label>Đến ngày học</label><input id="rt" type="date"></div></div>
      <div style="margin-top:14px"><button class="btn pink" id="go">Xuất Excel</button></div></div>`;
    $('#go').onclick = (e) => busy(e.target, () => exportReport($('#rc').value ? [$('#rc').value] : null, $('#rf').value, $('#rt').value));
    if (me.role === 'admin') teachHoursCard(el);
  }

  // Báo cáo giờ dạy giảng viên theo tháng (admin). Ca sáng = 4 giờ, chiều/tối = 5 giờ. Chỉ tính buổi đã mở điểm danh.
  function teachHoursCard(el) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const box = document.createElement('div');
    box.className = 'card';
    box.innerHTML = `<h2>Báo cáo giờ dạy giảng viên</h2>
      <p class="muted small">Tính các buổi đã mở điểm danh. Ca sáng 4 giờ, ca chiều và tối 5 giờ.</p>
      <div class="grid2"><div><label>Tháng</label><input id="thm" type="month" value="${ym}"></div>
        <div style="align-self:end"><button class="btn pink" id="thgo">Xem báo cáo</button></div></div>
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
    let cq = db.from('classes').select('id, name, start_date, class_types(name, max_absent)').order('name');
    if (classIds) cq = cq.in('id', classIds);
    const classes = await q(cq);
    if (!classes.length) throw new Error('Không có lớp nào để xuất');
    const ids = classes.map((c) => c.id);

    const sessions = await fetchAll(() => { let b = db.from('class_sessions').select('*').order('id'); if (classIds) b = b.in('class_id', ids); return b; });
    const roster = await fetchAll(() => { let b = db.from('class_students').select('class_id, students(*)').order('class_id').order('student_code'); if (classIds) b = b.in('class_id', ids); return b; });
    const att = await fetchAll(() => { let b = db.from('attendance').select('*, class_sessions!inner(class_id)').order('id'); if (classIds) b = b.in('class_sessions.class_id', ids); return b; });
    const amap = {}; att.forEach((a) => { amap[a.session_id + '|' + a.student_code] = a; });

    const detail = []; const summary = {};
    const limitByClass = {}; classes.forEach((c) => { limitByClass[c.name] = c.class_types?.max_absent; });
    for (const c of classes) {
      const sess = sessions.filter((s) => s.class_id === c.id)
        .filter((s) => (!from || (s.session_date && s.session_date >= from)) && (!to || (s.session_date && s.session_date <= to)))
        .sort((a, b) => a.session_no - b.session_no);
      const stu = roster.filter((r) => r.class_id === c.id).map((r) => r.students).filter(Boolean)
        .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'vi'));
      for (const st of stu) {
        const key = c.id + '|' + st.code;
        summary[key] = { 'Lớp': c.name, 'Mã HV': st.code, 'Họ tên': st.full_name, 'Chức danh': st.title || '',
          'Đúng giờ': 0, 'Muộn': 0, 'Vắng': 0, 'Chưa mở': 0 };
        const limit = c.class_types?.max_absent;
        for (const s of sess) {
          const a = amap[s.id + '|' + st.code];
          const status = lateInfo(s, c, a);
          const sKey = status.startsWith('Có mặt') ? 'Đúng giờ' : status;
          if (summary[key][sKey] !== undefined) summary[key][sKey]++;
          detail.push({
            'Lớp': c.name, 'Loại lớp': c.class_types?.name || '', 'Buổi': s.session_no, 'Nội dung': s.content || '',
            'Ngày học': fmtDate(s.session_date), 'Ca': s.shift ? SHIFT_LABEL[s.shift] : '', 'Mã HV': st.code, 'Họ tên': st.full_name,
            'Chức danh': st.title || '', 'Trạng thái': status,
            'Giờ điểm danh': a ? fmtTime(a.checked_at) : '', 'Hình thức': a ? (a.source === 'manual' ? 'Giảng viên điểm danh' : 'QR') : '',
          });
        }
      }
    }
    if (!detail.length) throw new Error('Không có dữ liệu trong khoảng này');
    const sum = Object.values(summary).map((r) => {
      const opened = r['Đúng giờ'] + r['Muộn'] + r['Vắng'];
      const lim = limitByClass[r['Lớp']];
      return { ...r, 'Tỷ lệ có mặt': opened ? Math.round(((r['Đúng giờ'] + r['Muộn']) / opened) * 100) + '%' : '',
        'Cảnh báo vắng': lim != null && r['Vắng'] > lim ? `Vắng quá ${lim} buổi` : '' };
    });
    const names = classes.map((c) => c.name).join(', ');
    const info = [['Lớp', classes.length > 3 ? `${classes.length} lớp` : names],
      ['Kỳ báo cáo', from || to ? `${from ? fmtDate(from) : '...'} → ${to ? fmtDate(to) : '...'}` : 'Toàn bộ thời gian'],
      ['Quy ước', 'Đúng giờ · Muộn · Vắng (chỉ tính các buổi đã mở điểm danh)']];
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await saveXlsx(`BaoCao_DiemDanh_${d}.xlsx`, [
      { name: 'Tổng hợp', title: 'Báo cáo tổng hợp điểm danh', info, rows: sum,
        cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Lớp', key: 'Lớp', width: 24 }, { header: 'Mã HV', key: 'Mã HV', width: 13, align: 'center' },
          { header: 'Họ và tên', key: 'Họ tên', width: 28 }, { header: 'Chức danh', key: 'Chức danh', width: 20 },
          { header: 'Đúng giờ', key: 'Đúng giờ', width: 10, align: 'center' }, { header: 'Muộn', key: 'Muộn', width: 9, align: 'center' },
          { header: 'Vắng', key: 'Vắng', width: 9, align: 'center' }, { header: 'Chưa mở', key: 'Chưa mở', width: 10, align: 'center' },
          { header: 'Tỷ lệ có mặt', key: 'Tỷ lệ có mặt', width: 12, align: 'center' }, { header: 'Cảnh báo', key: 'Cảnh báo vắng', width: 20 }] },
      { name: 'Chi tiết', title: 'Chi tiết điểm danh từng buổi', info, rows: detail,
        cols: [{ header: 'STT', key: '#', width: 6, align: 'center' }, { header: 'Lớp', key: 'Lớp', width: 24 }, { header: 'Loại lớp', key: 'Loại lớp', width: 16 },
          { header: 'Buổi', key: 'Buổi', width: 7, align: 'center' }, { header: 'Nội dung', key: 'Nội dung', width: 28 }, { header: 'Ngày học', key: 'Ngày học', width: 12, align: 'center' },
          { header: 'Ca', key: 'Ca', width: 9, align: 'center' }, { header: 'Mã HV', key: 'Mã HV', width: 13, align: 'center' }, { header: 'Họ và tên', key: 'Họ tên', width: 26 },
          { header: 'Chức danh', key: 'Chức danh', width: 18 }, { header: 'Trạng thái', key: 'Trạng thái', width: 20, color: STATUS_COLOR },
          { header: 'Giờ điểm danh', key: 'Giờ điểm danh', width: 20, align: 'center' }, { header: 'Hình thức', key: 'Hình thức', width: 20 }] },
    ]);
    toast('Đã xuất file Excel', 'ok');
  }

  // ================================================================ ADMIN: loại lớp
  async function viewTypes(el) {
    el.innerHTML = '<div class="card" id="newbox"></div><div class="card"><h2>Loại lớp</h2><p class="muted small">Mỗi loại lớp quy định số buổi và nội dung từng buổi. Khi giảng viên tạo lớp, các buổi được sinh ra theo mẫu này.</p><div id="t">Đang tải...</div></div>';
    const types = await q(db.from('class_types').select('id, name, description, max_absent, class_type_sessions(session_no, content, day_no, shift)').order('name'));
    $('#t').innerHTML = types.length ? types.map((t) => `<div style="border-top:1px solid var(--line);padding:10px 0">
      <div class="row between"><b>${esc(t.name)}</b> <span><span class="badge">${t.class_type_sessions.length} buổi</span>
        <button class="btn sm danger" data-del="${t.id}">Xóa</button></span></div>
      ${t.max_absent != null ? `<div class="small" style="color:var(--bad)">Cảnh báo khi vắng quá ${t.max_absent} buổi</div>` : ''}
      <div class="muted small">${esc(t.description || '')}</div>
      <ol class="small" style="margin:6px 0 0 18px">${t.class_type_sessions.sort((a, b) => a.session_no - b.session_no).map((s) => `<li>${s.day_no ? `<b>Ngày ${s.day_no}${s.shift ? ' · ' + SHIFT_LABEL[s.shift] : ''}:</b> ` : ''}${esc(s.content)}</li>`).join('')}</ol></div>`).join('')
      : '<p class="muted">Chưa có loại lớp nào.</p>';
    $$('[data-del]', el).forEach((b) => { b.onclick = () => {
      if (!confirm('Xóa loại lớp này? Các lớp đã tạo vẫn giữ nguyên.')) return;
      busy(b, async () => { await q(db.from('class_types').delete().eq('id', b.dataset.del)); render(); }); }; });
    $('#newbox').innerHTML = `<h3>Tạo loại lớp mới</h3><form id="tf">
      <label>Tên loại lớp</label><input id="tn" required placeholder="VD: LPFC">
      <label>Mô tả</label><input id="td">
      <label>Cảnh báo khi học viên vắng quá (số buổi, để trống nếu không cần)</label><input id="tm" type="number" min="0">
      <label>Nội dung các buổi (mỗi dòng là 1 buổi)</label>
      <textarea id="ts" required placeholder="Module 1 - Nền tảng&#10;Module 2 - Kỹ năng tư vấn"></textarea>
      <div style="margin-top:12px"><button class="btn pink">Lưu loại lớp</button></div></form>`;
    $('#tf').onsubmit = (e) => {
      e.preventDefault();
      busy($('#tf button'), async () => {
        const lines = $('#ts').value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!lines.length) throw new Error('Cần ít nhất 1 buổi');
        const t = await q(db.from('class_types').insert({ name: $('#tn').value.trim(), description: $('#td').value.trim() || null, max_absent: $('#tm').value === '' ? null : Number($('#tm').value) }).select().single());
        await q(db.from('class_type_sessions').insert(lines.map((c, i) => ({ class_type_id: t.id, session_no: i + 1, content: c }))));
        toast('Đã lưu loại lớp', 'ok'); render();
      });
    };
  }

  // ================================================================ ADMIN: nhân sự
  async function viewStaff(el) {
    el.innerHTML = `<div class="card"><h2>Admin & Giảng viên</h2>
      <p class="muted small">Thêm email vào danh sách, rồi gửi <b>mã mời</b> (hiện ở bảng bên dưới) cho người đó. Họ bấm "Đăng ký tài khoản?" ở màn hình đăng nhập, nhập email + mã mời để tạo tài khoản.</p>
      <form id="sf" class="grid2"><div><label>Email</label><input id="se" type="email" required></div>
        <div><label>Họ tên</label><input id="sn" required></div>
        <div><label>Quyền</label><select id="sr"><option value="teacher">Giảng viên</option><option value="admin">Admin</option></select></div>
        <div style="align-self:end"><button class="btn pink">Thêm vào danh sách</button></div></form></div>
      <div class="card"><div id="t">Đang tải...</div></div>`;
    const allowed = await q(db.from('allowed_staff').select('*').order('email'));
    const profs = await q(db.from('profiles').select('id, email, role').in('role', ['admin', 'teacher']));
    const pmap = {}; profs.forEach((p) => { pmap[p.email.toLowerCase()] = p; });
    $('#t').innerHTML = `<div class="tbl-wrap"><table><tr><th>Email</th><th>Họ tên</th><th>Quyền</th><th>Mã mời</th><th>Tài khoản</th><th></th></tr>
      ${allowed.map((a) => { const p = pmap[a.email.toLowerCase()]; return `<tr><td>${esc(a.email)}</td><td>${esc(a.full_name)}</td>
        <td>${ROLE_LABEL[a.role]}</td><td><code>${esc(a.invite_code)}</code></td><td>${p ? '<span class="badge ok">Đã đăng ký</span>' : '<span class="badge gray">Chưa</span>'}</td>
        <td class="act">${p && p.id !== me.id ? `<button class="btn sm danger" data-deluser="${p.id}">Xóa tài khoản</button>` : ''}
          ${p ? '' : `<button class="btn sm danger" data-delmail="${esc(a.email)}">Xóa khỏi danh sách</button>`}</td></tr>`; }).join('')}</table></div>`;
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

  boot();
})();
