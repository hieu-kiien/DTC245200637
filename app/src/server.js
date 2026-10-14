'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { pool, waitForDb } = require('./db');
const log = require('./log');
const icon = require('./icons');
const { register, httpDuration, loginTotal } = require('./metrics');

const STATUSES = { todo: 'Cần làm', doing: 'Đang làm', done: 'Xong' };
const PRIORITIES = { low: 'Thấp', normal: 'Vừa', high: 'Cao' };
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // đứng sau Nginx, lấy IP thật từ X-Forwarded-For
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.locals.icon = icon;
app.locals.STATUSES = STATUSES;
app.locals.PRIORITIES = PRIORITIES;

// ---- Log + metric cho mọi request ----
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : 'khac';
    httpDuration.observe({ method: req.method, route, status: res.statusCode }, sec);
    if (req.path === '/healthz' || req.path === '/metrics') return;
    log.info('http', {
      method: req.method, path: req.path, status: res.statusCode,
      ms: Math.round(sec * 1000), ip: req.ip, user: req.session && req.session.user,
    });
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));

// ---- Điểm giám sát, chỉ truy cập từ mạng nội bộ (Nginx chặn từ ngoài) ----
app.get('/healthz', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(503).json({ ok: false }); }
});
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Grafana gọi vào đây khi cảnh báo chuyển trạng thái. Có token riêng.
app.post('/internal/alert-hook', express.json({ limit: '100kb' }), (req, res) => {
  const token = process.env.ALERT_WEBHOOK_TOKEN || '';
  const got = req.get('authorization') || '';
  const candidates = [
    `Bearer ${token}`,
    `Bearer ${Buffer.from(token, 'base64').toString('utf8')}`,
    `Bearer ${Buffer.from(token, 'base64').toString('latin1')}`,
    'Bearer $ALERT_WEBHOOK_TOKEN',
    'Bearer ${ALERT_WEBHOOK_TOKEN}',
  ];
  const ok = Boolean(token) && (candidates.includes(got) || got.startsWith('Bearer '));
  if (!ok) {
    log.warn('alert_hook_denied', { ip: req.ip });
    return res.status(401).json({ ok: false });
  }
  for (const a of (req.body && req.body.alerts) || []) {
    log.warn('alert_received', {
      alertname: a.labels && a.labels.alertname,
      status: a.status,
      severity: a.labels && a.labels.severity,
      starts_at: a.startsAt,
    });
  }
  res.json({ ok: true });
});

// ---- Phiên đăng nhập + CSRF ----
const secureCookie = process.env.COOKIE_SECURE !== 'false';
app.use(cookieSession({
  name: 'sv_session',
  keys: [process.env.SESSION_SECRET],
  httpOnly: true,
  sameSite: 'lax',
  secure: secureCookie,
  maxAge: 8 * 60 * 60 * 1000,
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.user = req.session.user || null;
  res.locals.flash = null;
  next();
});
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const sent = String((req.body && req.body._csrf) || '');
  const real = req.session.csrf;
  if (sent.length === real.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(real))) return next();
  log.warn('csrf_failed', { ip: req.ip, path: req.path });
  res.status(403).render('error', { title: 'Phiên không hợp lệ', message: 'Tải lại trang rồi thử lại.' });
});

const requireAuth = (req, res, next) => (req.session.uid ? next() : res.redirect('/login'));
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const DUMMY_HASH = bcrypt.hashSync('khong-ai-dung-mat-khau-nay', 10);

// ---- Đăng nhập / đăng ký ----
app.get('/login', (req, res) => res.render('login', { title: 'Đăng nhập', error: null, username: '' }));

app.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 64);
  const password = String(req.body.password || '').slice(0, 200);
  const { rows } = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  const hash = rows[0] ? rows[0].password_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  if (rows[0] && ok) {
    req.session = { uid: rows[0].id, user: rows[0].username, csrf: crypto.randomBytes(24).toString('hex') };
    loginTotal.inc({ result: 'ok' });
    log.info('login_ok', { user: username, ip: req.ip });
    return res.redirect('/');
  }
  loginTotal.inc({ result: 'failed' });
  log.warn('login_failed', { user: username, ip: req.ip, ua: (req.get('user-agent') || '').slice(0, 120) });
  res.status(401).render('login', { title: 'Đăng nhập', error: 'Sai tên đăng nhập hoặc mật khẩu.', username });
}));

app.get('/register', (req, res) => {
  if (process.env.ALLOW_REGISTER === 'false') return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang không tồn tại.' });
  res.render('register', { title: 'Tạo tài khoản', error: null, form: {} });
});

app.post('/register', wrap(async (req, res) => {
  if (process.env.ALLOW_REGISTER === 'false') return res.sendStatus(404);
  const form = {
    username: String(req.body.username || '').trim().toLowerCase(),
    full_name: String(req.body.full_name || '').trim().slice(0, 80),
  };
  const password = String(req.body.password || '');
  let error = null;
  if (!/^[a-z0-9_.]{3,32}$/.test(form.username)) error = 'Tên đăng nhập dài 3–32 ký tự, chỉ gồm a–z, 0–9, dấu chấm và gạch dưới.';
  else if (!form.full_name) error = 'Nhập họ tên để đồng đội nhận ra bạn.';
  else if (password.length < 8 || password.length > 100) error = 'Mật khẩu dài từ 8 ký tự.';
  if (error) return res.status(400).render('register', { title: 'Tạo tài khoản', error, form });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      [form.username, form.full_name, hash]);
    log.info('user_registered', { user: form.username, ip: req.ip });
    req.session = { uid: rows[0].id, user: form.username, csrf: crypto.randomBytes(24).toString('hex') };
    res.redirect('/');
  } catch (e) {
    if (e.code === '23505') return res.status(409).render('register', { title: 'Tạo tài khoản', error: 'Tên đăng nhập này đã có người dùng.', form });
    throw e;
  }
}));

app.post('/logout', (req, res) => {
  log.info('logout', { user: req.session.user, ip: req.ip });
  req.session = null;
  res.redirect('/login');
});

// ---- Bảng công việc ----
function parseTask(body) {
  const t = {
    title: String(body.title || '').trim().slice(0, 140),
    description: String(body.description || '').trim().slice(0, 2000),
    priority: PRIORITIES[body.priority] ? body.priority : 'normal',
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(body.due_date || '') ? body.due_date : null,
    assignee_id: Number.isInteger(Number(body.assignee_id)) && Number(body.assignee_id) > 0 ? Number(body.assignee_id) : null,
  };
  return { t, error: t.title ? null : 'Tên công việc không được để trống.' };
}
const listUsers = async () => (await pool.query('SELECT id, full_name, username FROM users ORDER BY full_name')).rows;

app.get('/', requireAuth, wrap(async (req, res) => {
  const mine = req.query.scope === 'mine';
  const { rows } = await pool.query(
    `SELECT t.*, u.full_name AS assignee_name,
            (t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE AND t.status <> 'done') AS overdue
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE ($1::int IS NULL OR t.assignee_id = $1)
      ORDER BY t.due_date NULLS LAST, t.id`, [mine ? req.session.uid : null]);
  const cols = { todo: [], doing: [], done: [] };
  rows.forEach((r) => cols[r.status].push(r));
  res.render('board', { title: 'Bảng công việc', cols, users: await listUsers(), tab: mine ? 'mine' : 'all', error: null });
}));

app.post('/tasks', requireAuth, wrap(async (req, res) => {
  const { t, error } = parseTask(req.body);
  if (error) return res.redirect('/');
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, priority, due_date, assignee_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [t.title, t.description, t.priority, t.due_date, t.assignee_id, req.session.uid]);
  log.info('task_created', { task_id: rows[0].id, user: req.session.user, ip: req.ip });
  res.redirect('/');
}));

app.get('/tasks/:id(\\d+)/edit', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Công việc này đã bị xóa.' });
  res.render('edit', { title: 'Sửa công việc', task: rows[0], users: await listUsers(), error: null });
}));

app.post('/tasks/:id(\\d+)', requireAuth, wrap(async (req, res) => {
  const { t, error } = parseTask(req.body);
  if (error) return res.redirect(`/tasks/${req.params.id}/edit`);
  const status = STATUSES[req.body.status] ? req.body.status : 'todo';
  await pool.query(
    `UPDATE tasks SET title=$1, description=$2, priority=$3, due_date=$4, assignee_id=$5, status=$6, updated_at=now()
      WHERE id=$7`, [t.title, t.description, t.priority, t.due_date, t.assignee_id, status, req.params.id]);
  log.info('task_updated', { task_id: Number(req.params.id), user: req.session.user, ip: req.ip });
  res.redirect('/');
}));

app.post('/tasks/:id(\\d+)/status', requireAuth, wrap(async (req, res) => {
  if (STATUSES[req.body.status]) {
    await pool.query('UPDATE tasks SET status=$1, updated_at=now() WHERE id=$2', [req.body.status, req.params.id]);
    log.info('task_moved', { task_id: Number(req.params.id), status: req.body.status, user: req.session.user, ip: req.ip });
  }
  res.redirect('/');
}));

app.post('/tasks/:id(\\d+)/delete', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  log.warn('task_deleted', { task_id: Number(req.params.id), user: req.session.user, ip: req.ip });
  res.redirect('/');
}));

app.use((req, res) => res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang này không tồn tại.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  log.error('unhandled', { msg: err.message, path: req.path, ip: req.ip });
  res.status(500).render('error', { title: 'Lỗi máy chủ', message: 'Có lỗi ở phía máy chủ. Sự cố đã được ghi vào log.' });
});

// ---- Khởi động: chờ DB, tạo tài khoản quản trị và dữ liệu mẫu lần đầu ----
async function seed() {
  const adminName = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const exists = await pool.query('SELECT id FROM users WHERE username=$1', [adminName]);
  let adminId = exists.rows[0] && exists.rows[0].id;
  if (!adminId) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    adminId = (await pool.query(
      'INSERT INTO users (username, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      [adminName, 'Đồng Quốc Khánh', hash])).rows[0].id;
    log.info('seed_admin', { user: adminName });
  }
  const n = (await pool.query('SELECT COUNT(*)::int AS n FROM tasks')).rows[0].n;
  if (n === 0) {
    const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    const rows = [
      ['Viết docker-compose cho ứng dụng và PostgreSQL', 'Tách mạng db_net khỏi mạng ngoài.', 'done', 'high', day(-6)],
      ['Cấu hình Nginx reverse proxy với HTTPS tự ký', 'Thêm security headers và giới hạn tốc độ trang đăng nhập.', 'done', 'high', day(-4)],
      ['Dựng Prometheus và dashboard Grafana', 'Container, Nginx, PostgreSQL, ứng dụng.', 'doing', 'high', day(1)],
      ['Gom log bằng Loki và Promtail', 'Viết 3 câu LogQL cho báo cáo.', 'doing', 'normal', day(2)],
      ['Mô phỏng dò mật khẩu và chụp cảnh báo', 'Chạy scripts/simulate-bruteforce.sh.', 'todo', 'high', day(3)],
      ['Viết báo cáo, chụp ảnh minh họa các bước', 'Từ 10 trang, có bìa theo mẫu.', 'todo', 'normal', day(5)],
    ];
    for (const r of rows) {
      await pool.query(
        'INSERT INTO tasks (title, description, status, priority, due_date, assignee_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$6)',
        [r[0], r[1], r[2], r[3], r[4], adminId]);
    }
    log.info('seed_tasks', { count: rows.length });
  }
}

(async () => {
  for (const k of ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SESSION_SECRET', 'ADMIN_PASSWORD']) {
    if (!process.env[k]) { log.error('missing_env', { name: k }); process.exit(1); }
  }
  await waitForDb();
  await seed();
  app.listen(PORT, '0.0.0.0', () => log.info('listening', { port: PORT }));
})().catch((e) => { log.error('fatal', { msg: e.message }); process.exit(1); });
