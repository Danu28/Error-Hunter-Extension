// Error Hunter - Bug report tab: Copy to Clipboard button.
// External script (not inline) because the MV3 extension CSP (script-src 'self')
// blocks inline <script> and inline onclick handlers in extension-origin pages.
document.getElementById('copyReportBtn').addEventListener('click', function () {
  var textarea = document.getElementById('r');
  textarea.select();
  navigator.clipboard.writeText(textarea.value).then(function () {
    var btn = document.getElementById('copyReportBtn');
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = 'Copy to Clipboard'; }, 2000);
  });
});
