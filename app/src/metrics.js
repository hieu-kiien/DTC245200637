'use strict';
const client = require('prom-client');
const { pool } = require('./db');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'soviec_' });

const httpDuration = new client.Histogram({
  name: 'soviec_http_request_duration_seconds',
  help: 'Thời gian xử lý request HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

const loginTotal = new client.Counter({
  name: 'soviec_login_total',
  help: 'Số lần đăng nhập, chia theo kết quả',
  labelNames: ['result'],
  registers: [register],
});

new client.Gauge({
  name: 'soviec_tasks',
  help: 'Số công việc theo trạng thái',
  labelNames: ['status'],
  registers: [register],
  async collect() {
    this.reset();
    const { rows } = await pool.query('SELECT status, COUNT(*)::int AS n FROM tasks GROUP BY status');
    for (const s of ['todo', 'doing', 'done']) this.set({ status: s }, 0);
    for (const r of rows) this.set({ status: r.status }, r.n);
  },
});

module.exports = { register, httpDuration, loginTotal };
