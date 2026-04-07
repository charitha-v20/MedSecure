// ============================================================
// ui.js — Toast, Activity Log, Dashboard, Render helpers
// ============================================================

const STORE_COLORS = [
  ['#00d4ff','#0099cc','#005f80'], // StoreA
  ['#7b5ea7','#5a3d80','#3a2060'], // StoreB
  ['#00ff9d','#00cc7a','#008050'], // StoreC
];

// ---- TOAST ----
window.toast = function(msg, type = 'info', icon = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
  el.innerHTML = `<span>${icon || icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ---- ACTIVITY LOG ----
window.addLog = function(msg, type = 'info') {
  const now = new Date();
  const t = now.toTimeString().slice(0, 5);
  const el = document.createElement('div');
  el.className = 'log-entry';
  const typeMap = { auth: 'auth', store: 'store', warn: 'warn', error: 'err', info: 'auth' };
  el.innerHTML = `<span class="log-time">${t}</span><span class="log-type ${typeMap[type] || 'auth'}">${type.toUpperCase()}</span><span class="log-msg">${msg}</span>`;
  const logEl = document.getElementById('activityLog');
  logEl.insertBefore(el, logEl.firstChild);
  if (logEl.children.length > 14) logEl.lastChild.remove();
};

// ---- DASHBOARD ----
window.updateDashboard = function() {
  document.getElementById('statUsers').textContent = STATE.users.length;
  document.getElementById('statFiles').textContent = STATE.files.length;
  document.getElementById('statFrags').textContent = STATE.files.reduce((s, f) => s + (f.fragmentCount || 0), 0);
  document.getElementById('statSessions').textContent = STATE.sessions;
  renderFragGrid();
};

function renderFragGrid() {
  const grid = document.getElementById('dashFragGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const total = 32;
  const used = Math.min(STATE.files.reduce((s, f) => s + (f.fragmentCount || 0), 0), total);
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    cell.className = 'frag-cell';
    if (i < used) {
      const si = i % 3;
      cell.style.background = STORE_COLORS[si][0];
      cell.classList.add('active');
    } else {
      cell.style.background = 'var(--border)';
    }
    grid.appendChild(cell);
  }
}

// ---- RENDER USERS ----
window.renderUsers = function() {
  const grid = document.getElementById('usersGrid');
  if (STATE.users.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">👥</div><div class="empty-text">No users registered. Use Biometric Auth → Register.</div></div>';
    return;
  }
  grid.innerHTML = '';
  STATE.users.forEach(u => {
    const roleColors = {
      Doctor:     { bg: 'rgba(0,212,255,0.1)',   c: 'var(--accent)' },
      Nurse:      { bg: 'rgba(0,255,157,0.1)',   c: 'var(--accent3)' },
      Admin:      { bg: 'rgba(255,165,2,0.1)',   c: 'var(--warn)' },
      Patient:    { bg: 'rgba(123,94,167,0.2)',  c: '#a569bd' },
      Technician: { bg: 'rgba(255,71,87,0.1)',   c: 'var(--danger)' },
    };
    const rc = roleColors[u.role] || roleColors.Admin;
    const card = document.createElement('div');
    card.className = 'user-card';
    const avatarContent = u.avatar && u.avatar !== 'simulated'
      ? `<img src="${u.avatar}" alt="${u.name}">`
      : getRoleEmoji(u.role);
    card.innerHTML = `
      <div class="user-avatar">${avatarContent}</div>
      <div class="user-name">${u.name}</div>
      <div class="user-id">${u.id}</div>
      <div class="user-badge" style="background:${rc.bg};color:${rc.c}">${u.role}</div>
      <div style="margin-top:6px;font-size:0.65rem;color:var(--text3);font-family:'DM Mono',monospace">${u.registeredAt || ''}</div>
    `;
    grid.appendChild(card);
  });
};

function getRoleEmoji(role) {
  const m = { Doctor: '👨‍⚕️', Nurse: '👩‍⚕️', Admin: '👔', Patient: '🧑', Technician: '🔬' };
  return m[role] || '👤';
}

// ---- RENDER FILES ----
window.renderFiles = function() {
  const el = document.getElementById('filesList');
  if (STATE.files.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No files stored yet. Upload a file to get started.</div></div>';
    renderStorageInfo();
    return;
  }

  el.innerHTML = '';
  [...STATE.files].reverse().forEach(f => {
    const typeIcons = { 'application/pdf': '📄', 'image/jpeg': '🖼', 'image/png': '🖼', 'text/plain': '📝' };
    const icon = typeIcons[f.type] || '📁';
    const iconColors = { 'application/pdf': '#ff4757', 'image/jpeg': '#7b5ea7', 'image/png': '#5dade2' };
    const bg = iconColors[f.type] || '#00d4ff';

    const storeNames = ['StoreA', 'StoreB', 'StoreC'];
    const fragPips = Array.from({ length: f.fragmentCount || 8 }, (_, i) => {
      const si = i % 3;
      return `<div class="frag-pip" title="Chunk ${i + 1} → ${storeNames[si]}" style="background:${STORE_COLORS[si][0]}"></div>`;
    }).join('');

    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-icon" style="background:${bg}22;border:1px solid ${bg}44">${icon}</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">
          <span>${formatSize(f.size)}</span>
          <span>${f.fragmentCount || 8} fragments</span>
          <span>StoreA / StoreB / StoreC</span>
          <span>${f.uploadedAt || ''}</span>
        </div>
        <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">${fragPips}</div>
      </div>
      <div class="file-actions">
        <button class="btn btn-success" style="font-size:0.72rem;padding:7px 12px" onclick="retrieveFile('${f.id}')">↓ Retrieve</button>
        <button class="btn btn-danger" style="font-size:0.72rem;padding:7px 12px" onclick="deleteFile('${f.id}')">✕</button>
      </div>
    `;
    el.appendChild(item);
  });

  renderStorageInfo();
};

function renderStorageInfo() {
  const infoEl = document.getElementById('storageInfo');
  if (!infoEl) return;
  const totalBytes = STATE.files.reduce((s, f) => s + (f.size || 0), 0);
  const totalFrags = STATE.files.reduce((s, f) => s + (f.fragmentCount || 0), 0);
  // Estimate localStorage usage
  let lsSize = 0;
  try {
    for (let k in localStorage) {
      if (k.startsWith('medsecure') || k.startsWith('Store')) {
        lsSize += (localStorage[k] || '').length * 2;
      }
    }
  } catch(e) {}
  infoEl.innerHTML = `
    <div class="storage-stat"><span>Files</span><span>${STATE.files.length}</span></div>
    <div class="storage-stat"><span>Total Size</span><span>${formatSize(totalBytes)}</span></div>
    <div class="storage-stat"><span>Fragments</span><span>${totalFrags}</span></div>
    <div class="storage-stat"><span>LocalStorage Used</span><span>${formatSize(lsSize)}</span></div>
    <div class="storage-stat"><span>Stores Active</span><span>${STATE.files.length > 0 ? 'A + B + C' : '—'}</span></div>
  `;
}

// ---- RPF DEMO ----
window.animateRPFDemo = function(name, size, numFrags, pattern) {
  const colors = ['#00d4ff','#7b5ea7','#00ff9d','#ffa502','#ff6b81','#5dade2','#a569bd','#52be80'];
  
  const origV = document.getElementById('origVisual');
  if (origV) {
    origV.innerHTML = '';
    for (let i = 0; i < numFrags; i++) {
      const b = document.createElement('div');
      b.className = 'frag-block';
      b.style.background = colors[i];
      b.style.color = '#000';
      b.textContent = i + 1;
      origV.appendChild(b);
    }
    document.getElementById('origLabel').textContent = name + ' (' + formatSize(size) + ')';
  }

  const fragV = document.getElementById('fragVisual');
  if (fragV && pattern) {
    fragV.innerHTML = '';
    pattern.forEach(idx => {
      const b = document.createElement('div');
      b.className = 'frag-block';
      b.style.background = colors[idx % colors.length];
      b.style.color = '#000';
      b.textContent = idx + 1;
      fragV.appendChild(b);
    });
  }

  const distV = document.getElementById('distVisual');
  if (distV && pattern) {
    distV.innerHTML = '';
    pattern.forEach((_, i) => {
      const si = i % 3;
      const b = document.createElement('div');
      b.className = 'frag-block';
      b.style.background = STORE_COLORS[si][0];
      b.style.color = '#000';
      b.title = ['A','B','C'][si];
      b.textContent = ['A','B','C'][si];
      distV.appendChild(b);
    });
  }
};

// ---- AUTH STEP HELPER ----
window.setStep = function(num, status) {
  const el = document.getElementById('step' + num);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (status) el.classList.add(status);
  const numEl = el.querySelector('.step-num');
  if (status === 'done') numEl.textContent = '✓';
  else numEl.textContent = num;
};

// ---- FORMAT UTILS ----
window.formatSize = function(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
};

window.sleep = ms => new Promise(r => setTimeout(r, ms));