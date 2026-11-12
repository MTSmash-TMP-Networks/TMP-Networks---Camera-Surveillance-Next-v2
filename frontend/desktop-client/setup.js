"use strict";
const form = document.getElementById('connect');
const input = document.getElementById('server');
const error = document.getElementById('error');
window.tmpDesktop?.currentServer().then((saved) => { if (saved) input.value = saved; });
form.addEventListener('submit', async (event) => {
  event.preventDefault(); error.textContent = '';
  try { await window.tmpDesktop.connect(input.value); }
  catch (problem) { error.textContent = problem.message || 'Verbindung fehlgeschlagen'; }
});
