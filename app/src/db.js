'use strict';
const { Pool } = require('pg');
const log = require('./log');

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => log.error('db_pool_error', { msg: err.message }));

async function waitForDb(tries = 30) {
  for (let i = 1; i <= tries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      log.warn('db_wait', { attempt: i, msg: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Không kết nối được cơ sở dữ liệu');
}

module.exports = { pool, waitForDb };
