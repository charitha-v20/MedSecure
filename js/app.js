// ============================================================
// app.js — Global state, navigation, initialization
// ============================================================

// ---- GLOBAL STATE ----
window.STATE = {
  users: [],
  files: [],
  sessions: 0,
  currentUser: null,
  loginStream: null,
  regStream: null,
  regFaceCaptured: false,
  regFaceDescriptor: null,
  regFaceAvatar: null,
  regFpCaptured: false,
  regFaceInFrame: false,
  loginFaceDetected: false,
};

// ---- NAVIGATION ----
window.showPage = function(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (btn) {
    if (typeof btn === 'string') {
      document.querySelectorAll('nav button').forEach(b => {
        if (b.dataset.page === btn) b.classList.add('active');
      });
    } else {
      btn.classList.add('active');
    }
  }
  if (id === 'dashboard') updateDashboard();
  if (id === 'users') renderUsers();
  if (id === 'storage') renderFiles();
};

window.switchAuthTab = function(tab, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('authTabLogin').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('authTabRegister').style.display = tab === 'register' ? '' : 'none';
  if (tab !== 'login') stopLoginCamera();
  if (tab !== 'register') stopRegCamera();
};

// ---- INIT ----
window.addEventListener('DOMContentLoaded', async () => {
  // Load persisted data
  loadFromStorage();
  updateDashboard();

  // Clock in status bar
  const updateClock = () => {
    const el = document.getElementById('systemStatus');
    if (el) el.textContent = 'System Online — ' + new Date().toTimeString().slice(0,5);
  };
  updateClock();
  setInterval(updateClock, 10000);

  addLog('MedSecure initialized — loading face recognition models...', 'store');
  addLog('Data loaded from localStorage', 'info');

  // Load face-api.js models
  await loadFaceModels();

  addLog(`${STATE.users.length} users | ${STATE.files.length} files loaded from storage`, 'store');
});