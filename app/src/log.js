'use strict';
// Mỗi dòng log là một đối tượng JSON để Loki đọc được bằng "| json".
function write(level, event, fields) {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  process.stdout.write(JSON.stringify(line) + '\n');
}
module.exports = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
