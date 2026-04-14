// ============================================================
// ui.js — Toast, Log, Dashboard, Render helpers
// ============================================================

const STORE_COLORS = [
  ['#00d4ff','#0099cc'],
  ['#7b5ea7','#5a3d80'],
  ['#00ff9d','#00cc7a'],
];

// ---- TOAST ----
window.toast = function(msg, type='info', icon='') {
  const icons = {info:'ℹ️',success:'✅',error:'❌',warn:'⚠️'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icon||icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ---- ACTIVITY LOG ----
window.addLog = function(msg, type='info') {
  const t = new Date().toTimeString().slice(0,5);
  const el = document.createElement('div');
  el.className = 'log-entry';
  const typeMap = {auth:'auth',store:'store',warn:'warn',error:'err',info:'auth'};
  el.innerHTML = `<span class="log-time">${t}</span><span class="log-type ${typeMap[type]||'auth'}">${type.toUpperCase()}</span><span class="log-msg">${msg}</span>`;
  const logEl = document.getElementById('activityLog');
  if (logEl) { logEl.insertBefore(el, logEl.firstChild); if (logEl.children.length > 15) logEl.lastChild.remove(); }
};

// ---- DASHBOARD ----
window.updateDashboard = function() {
  document.getElementById('statUsers').textContent  = STATE.users.length;
  document.getElementById('statFiles').textContent  = STATE.files.length;
  document.getElementById('statFrags').textContent  = STATE.files.reduce((s,f)=>s+(f.fragmentCount||0),0);
  document.getElementById('statSessions').textContent = STATE.sessions;
  renderFragGrid();
  updateStorageModeUI();
};

function renderFragGrid() {
  const grid = document.getElementById('dashFragGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const total = 32;
  const used  = Math.min(STATE.files.reduce((s,f)=>s+(f.fragmentCount||0),0), total);
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    cell.className = 'frag-cell';
    if (i < used) {
      cell.style.background = STORE_COLORS[i % 3][0];
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
  if (!grid) return;
  if (!STATE.users.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">👥</div><div class="empty-text">No users registered yet.</div></div>';
    return;
  }
  grid.innerHTML = '';
  STATE.users.forEach(u => {
    const role = ROLES[u.role] || ROLES.Admin;
    const avatar = (u.avatar && u.avatar !== 'simulated')
      ? `<img src="${u.avatar}" alt="${u.name}">`
      : getRoleEmoji(u.role);
    const fpBadge = u.fpMode === 'webauthn'
      ? `<span class="chip" style="background:rgba(0,255,157,0.1);color:var(--accent3);margin-top:4px">🔒 WebAuthn</span>`
      : u.fpMode === 'orb'
      ? `<span class="chip" style="background:rgba(255,165,2,0.1);color:var(--warn);margin-top:4px">🖐 ORB sim</span>`
      : `<span class="chip" style="background:rgba(42,48,69,0.5);color:var(--text3);margin-top:4px">No FP</span>`;

    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="user-avatar">${avatar}</div>
      <div class="user-name">${u.name}</div>
      <div class="user-id">${u.id}</div>
      <div class="user-badge" style="background:${role.bg};color:${role.color}">${role.emoji} ${u.role}</div>
      ${fpBadge}
      <div style="margin-top:6px;font-size:0.63rem;color:var(--text3);font-family:'DM Mono',monospace">${u.registeredAt||''}</div>
      ${can('canRegisterUsers') ? `<button class="btn btn-danger" style="margin-top:8px;font-size:0.68rem;padding:5px 10px;width:100%" onclick="deleteUser('${u.id}')">Remove</button>` : ''}
    `;
    grid.appendChild(card);
  });
};

window.deleteUser = function(id) {
  if (!can('canRegisterUsers')) { toast('Only Admin can remove users', 'error'); return; }
  const u = STATE.users.find(x => x.id === id);
  if (!u || !confirm(`Remove ${u.name}?`)) return;
  STATE.users = STATE.users.filter(x => x.id !== id);
  persistUsers();
  renderUsers();
  updateDashboard();
  toast(`${u.name} removed`, 'warn');
  addLog(`User removed: ${u.name}`, 'warn');
};

// ---- RENDER FILES ----
window.renderFiles = function() {
  const el = document.getElementById('filesList');
  if (!el) return;

  const user = STATE.currentUser;

  // Filter based on role
  let visibleFiles = STATE.files;
  if (user && user.role === 'Patient') {
    visibleFiles = STATE.files.filter(f => canAccessFile(f, user));
  }

  if (!visibleFiles.length) {
    const msg = user?.role === 'Patient'
      ? 'No files have been shared with you yet.'
      : 'No files stored yet. Upload a file to get started.';
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">${msg}</div></div>`;
    renderStorageInfo();
    return;
  }

  el.innerHTML = '';
  [...visibleFiles].reverse().forEach(f => {
    const typeIcons  = {'application/pdf':'📄','image/jpeg':'🖼','image/png':'🖼','text/plain':'📝'};
    const typeColors = {'application/pdf':'#ff4757','image/jpeg':'#7b5ea7','image/png':'#5dade2'};
    const icon = typeIcons[f.type] || '📁';
    const bg   = typeColors[f.type] || '#00d4ff';

    const pips = Array.from({length:f.fragmentCount||8},(_,i)=>{
      const si = i%3;
      return `<div class="frag-pip" title="Chunk ${i+1} → ${['StoreA','StoreB','StoreC'][si]}" style="background:${STORE_COLORS[si][0]}"></div>`;
    }).join('');

    const backendBadge = f.storageBackend === 'aws'
      ? `<span style="color:var(--warn);font-size:0.65rem">☁ AWS S3</span>`
      : `<span style="color:var(--accent);font-size:0.65rem">💾 localStorage</span>`;

    const canDel  = canDeleteFile(f, user);
    const canDown = canAccessFile(f, user);

    // Share button (doctor can share with patient)
    const shareBtn = (user?.role === 'Doctor' || user?.role === 'Admin') && STATE.users.some(u=>u.role==='Patient')
      ? `<button class="btn btn-secondary" style="font-size:0.68rem;padding:6px 10px" onclick="openShareModal('${f.id}')">Share</button>`
      : '';

    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-icon" style="background:${bg}22;border:1px solid ${bg}44">${icon}</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">
          <span>${formatSize(f.size)}</span>
          <span>${f.fragmentCount||8} fragments</span>
          <span>by ${f.uploadedByName||'?'}</span>
          <span>${f.uploadedAt||''}</span>
          ${backendBadge}
        </div>
        <div style="margin-top:6px;display:flex;gap:3px;flex-wrap:wrap;align-items:center">${pips}</div>
      </div>
      <div class="file-actions">
        ${canDown ? `<button class="btn btn-success" style="font-size:0.72rem;padding:7px 12px" onclick="retrieveFile('${f.id}')">↓ Get</button>` : ''}
        ${shareBtn}
        ${canDel  ? `<button class="btn btn-danger"  style="font-size:0.72rem;padding:7px 12px" onclick="deleteFile('${f.id}')">✕</button>` : ''}
      </div>
    `;
    el.appendChild(item);
  });

  renderStorageInfo();
};

// ---- SHARE MODAL ----
window.openShareModal = function(fileId) {
  const patients = STATE.users.filter(u => u.role === 'Patient');
  if (!patients.length) { toast('No patients registered', 'warn'); return; }
  const f = STATE.files.find(x => x.id === fileId);
  if (!f) return;

  const modal = document.getElementById('shareModal');
  const list  = document.getElementById('sharePatientList');
  list.innerHTML = patients.map(p => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg2);border-radius:6px;cursor:pointer">
      <input type="checkbox" value="${p.id}" ${(f.sharedWith||[]).includes(p.id)?'checked':''}>
      <span>${p.name} <span style="color:var(--text3);font-size:0.7rem">${p.id}</span></span>
    </label>
  `).join('');

  modal.dataset.fileId = fileId;
  modal.classList.add('open');
};

window.saveShare = function() {
  const modal = document.getElementById('shareModal');
  const fileId = modal.dataset.fileId;
  const f = STATE.files.find(x => x.id === fileId);
  if (!f) return;
  const checked = [...modal.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
  f.sharedWith = checked;
  persistFiles();
  modal.classList.remove('open');
  renderFiles();
  toast(`Shared with ${checked.length} patient(s)`, 'success');
  addLog(`File "${f.name}" shared with ${checked.length} patient(s)`, 'store');
};

// ---- STORAGE INFO ----
function renderStorageInfo() {
  const el = document.getElementById('storageInfo');
  if (!el) return;
  const s = getStorageStats();
  el.innerHTML = `
    <div class="storage-stat"><span>Files</span><span>${s.totalFiles}</span></div>
    <div class="storage-stat"><span>Total Size</span><span>${formatSize(s.totalBytes)}</span></div>
    <div class="storage-stat"><span>Fragments</span><span>${s.totalFrags}</span></div>
    <div class="storage-stat"><span>LS Used</span><span>${formatSize(s.lsSize)}</span></div>
    <div class="storage-stat"><span>Backend</span><span id="storageBadge"></span></div>
  `;
  updateStorageModeUI();
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
      b.style.cssText = `background:${colors[i]};color:#000`;
      b.textContent = i+1;
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
      b.style.cssText = `background:${colors[idx%colors.length]};color:#000`;
      b.textContent = idx+1;
      fragV.appendChild(b);
    });
  }

  const distV = document.getElementById('distVisual');
  if (distV && pattern) {
    distV.innerHTML = '';
    pattern.forEach((_,i) => {
      const si = i%3;
      const b = document.createElement('div');
      b.className = 'frag-block';
      b.style.cssText = `background:${STORE_COLORS[si][0]};color:#000`;
      b.title = ['A','B','C'][si];
      b.textContent = ['A','B','C'][si];
      distV.appendChild(b);
    });
  }
};

// ---- STEP HELPER ----
window.setStep = function(num, status) {
  const el = document.getElementById('step'+num);
  if (!el) return;
  el.classList.remove('active','done');
  if (status) el.classList.add(status);
  const n = el.querySelector('.step-num');
  if (n) n.textContent = status==='done' ? '✓' : num;
};

// ---- AUDIT TRAIL PAGE ----
window.renderAudit = function() {
  const el = document.getElementById('auditList');
  if (!el) return;
  const log = STATE.auditLog || [];
  if (!log.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No audit events yet.</div></div>';
    return;
  }
  el.innerHTML = log.map(e => `
    <div class="log-entry">
      <span class="log-time">${e.ts.slice(11,16)}</span>
      <span class="log-type auth">${e.action}</span>
      <span class="log-msg">${e.detail} <span style="color:var(--text3)">[${e.user}]</span></span>
    </div>
  `).join('');
};

// ---- UTILS ----
window.formatSize = function(bytes) {
  if (!bytes || bytes < 1024) return (bytes||0)+' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1)+' KB';
  return (bytes/1048576).toFixed(1)+' MB';
};
window.sleep = ms => new Promise(r => setTimeout(r, ms));

function getRoleEmoji(role) {
  return {Doctor:'👨‍⚕️',Nurse:'👩‍⚕️',Admin:'👔',Patient:'🧑',Technician:'🔬'}[role] || '👤';
}