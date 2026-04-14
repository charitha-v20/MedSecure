// ============================================================
// permissions.js — Role-Based Access Control (RBAC)
// ============================================================
// Roles: Admin, Doctor, Nurse, Technician, Patient
//
// PERMISSIONS TABLE:
// ┌─────────────┬───────┬────────┬───────┬─────────────┬─────────┐
// │ Action      │ Admin │ Doctor │ Nurse │ Technician  │ Patient │
// ├─────────────┼───────┼────────┼───────┼─────────────┼─────────┤
// │ Register    │  ✓    │        │       │             │         │
// │ Upload File │  ✓    │  ✓     │  ✓    │   ✓         │         │
// │ View Files  │  ✓    │  ✓     │  ✓    │   ✓         │  ✓(own) │
// │ Delete File │  ✓    │  ✓(own)│       │             │         │
// │ View Users  │  ✓    │  ✓     │  ✓    │   ✓         │         │
// │ Config AWS  │  ✓    │        │       │             │         │
// └─────────────┴───────┴────────┴───────┴─────────────┴─────────┘
// ============================================================

window.ROLES = {
  Admin:      { label: 'Admin',       emoji: '👔', color: '#ffa502', bg: 'rgba(255,165,2,0.12)' },
  Doctor:     { label: 'Doctor',      emoji: '👨‍⚕️', color: '#00d4ff', bg: 'rgba(0,212,255,0.1)' },
  Nurse:      { label: 'Nurse',       emoji: '👩‍⚕️', color: '#00ff9d', bg: 'rgba(0,255,157,0.1)' },
  Technician: { label: 'Technician',  emoji: '🔬', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  Patient:    { label: 'Patient',     emoji: '🧑', color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
};

window.PERMISSIONS = {
  canRegisterUsers:    ['Admin'],
  canUploadFiles:      ['Admin', 'Doctor', 'Nurse', 'Technician'],
  canDeleteAnyFile:    ['Admin'],
  canDeleteOwnFile:    ['Admin', 'Doctor', 'Nurse', 'Technician'],
  canViewAllFiles:     ['Admin', 'Doctor', 'Nurse', 'Technician'],
  canViewOwnFiles:     ['Admin', 'Doctor', 'Nurse', 'Technician', 'Patient'],
  canViewUsers:        ['Admin', 'Doctor', 'Nurse', 'Technician'],
  canConfigureAWS:     ['Admin'],
  canViewDashboard:    ['Admin', 'Doctor', 'Nurse', 'Technician'],
};

window.can = function(action, user) {
  user = user || STATE.currentUser;
  if (!user) return false;
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(user.role);
};

// Check if user can see/download a specific file
window.canAccessFile = function(file, user) {
  user = user || STATE.currentUser;
  if (!user) return false;
  if (can('canViewAllFiles', user)) return true;
  // Patient can only see files explicitly shared with them (uploaded by doctor for them)
  if (user.role === 'Patient') {
    return file.sharedWith && file.sharedWith.includes(user.id);
  }
  return false;
};

window.canDeleteFile = function(file, user) {
  user = user || STATE.currentUser;
  if (!user) return false;
  if (can('canDeleteAnyFile', user)) return true;
  if (can('canDeleteOwnFile', user) && file.uploadedBy === user.id) return true;
  return false;
};

// Apply role-based UI visibility after login
window.applyPermissionUI = function() {
  const user = STATE.currentUser;
  if (!user) return;

  // Nav buttons
  const navBtns = {
    dashboard: can('canViewDashboard'),
    storage: true, // everyone sees storage (filtered)
    users: can('canViewUsers'),
  };

  document.querySelectorAll('nav button[data-page]').forEach(btn => {
    const page = btn.dataset.page;
    if (page === 'auth') return; // always visible
    btn.style.display = navBtns[page] === false ? 'none' : '';
  });

  // Upload zone
  const uploadZone = document.getElementById('uploadZone');
  if (uploadZone) {
    if (can('canUploadFiles')) {
      uploadZone.style.display = '';
      uploadZone.style.opacity = '1';
      uploadZone.style.pointerEvents = '';
    } else {
      uploadZone.style.display = 'none';
    }
  }

  // Register tab (only admin sees it in auth page)
  const regTab = document.getElementById('tabRegister');
  if (regTab) regTab.style.display = can('canRegisterUsers') ? '' : 'none';

  // AWS config tab (only admin)
  const awsTab = document.getElementById('tabAWS');
  if (awsTab) awsTab.style.display = can('canConfigureAWS') ? '' : 'none';

  // Update user badge in header
  const headerBadge = document.getElementById('headerUserBadge');
  if (headerBadge && user) {
    const role = ROLES[user.role] || ROLES.Admin;
    headerBadge.innerHTML = `
      <span style="color:${role.color}">${role.emoji}</span>
      <span style="color:var(--text2)">${user.name}</span>
      <span style="background:${role.bg};color:${role.color};padding:1px 7px;border-radius:6px;font-size:0.65rem">${user.role}</span>
    `;
    headerBadge.style.display = 'flex';
  }

  const logoutBtn = document.getElementById('btnLogout');
  if (logoutBtn) logoutBtn.style.display = '';
};

window.clearPermissionUI = function() {
  document.querySelectorAll('nav button[data-page]').forEach(btn => btn.style.display = '');
  const uploadZone = document.getElementById('uploadZone');
  if (uploadZone) { uploadZone.style.display = ''; uploadZone.style.opacity = ''; uploadZone.style.pointerEvents = ''; }
  const headerBadge = document.getElementById('headerUserBadge');
  if (headerBadge) headerBadge.style.display = 'none';
  const logoutBtn = document.getElementById('btnLogout');
  if (logoutBtn) logoutBtn.style.display = 'none';
};