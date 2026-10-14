// Hộp xác nhận khi xóa. Viết ở file riêng vì CSP của Nginx không cho script nằm trong HTML.
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
