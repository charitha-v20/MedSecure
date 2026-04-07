// ============================================================
// storage.js — localStorage persistence + RPF fragmentation
// ============================================================
// localStorage key schema:
//   medsecure_users         → JSON array of user profiles (no binary, descriptors as arrays)
//   medsecure_files         → JSON array of file metadata
//   medsecure_sessions      → number
//   StoreA_{fileId}_{i}     → base64-encoded fragment
//   StoreB_{fileId}_{i}     → base64-encoded fragment
//   StoreC_{fileId}_{i}     → base64-encoded fragment
// ============================================================

const STORE_NAMES = ['StoreA', 'StoreB', 'StoreC'];
const NUM_FRAGS = 8;

// ---- PERSIST ----
window.persistUsers = function() {
  try {
    // Don't store the actual face descriptor Float32Array from face-api — convert to plain array
    const serializable = STATE.users.map(u => ({
      ...u,
      faceDescriptor: u.faceDescriptor ? Array.from(u.faceDescriptor) : null,
    }));
    localStorage.setItem('medsecure_users', JSON.stringify(serializable));
  } catch(e) {
    console.warn('Could not persist users:', e);
    toast('Storage quota may be exceeded', 'warn');
  }
};

window.persistFiles = function() {
  try {
    // Only persist metadata, not fragment binary (stored separately)
    const meta = STATE.files.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      fragmentCount: f.fragmentCount,
      pattern: f.pattern,
      uploadedAt: f.uploadedAt,
    }));
    localStorage.setItem('medsecure_files', JSON.stringify(meta));
  } catch(e) {
    console.warn('Could not persist file metadata:', e);
  }
};

window.persistSessions = function() {
  localStorage.setItem('medsecure_sessions', String(STATE.sessions));
};

// ---- LOAD ----
window.loadFromStorage = function() {
  try {
    const users = localStorage.getItem('medsecure_users');
    if (users) {
      STATE.users = JSON.parse(users).map(u => ({
        ...u,
        faceDescriptor: u.faceDescriptor ? new Float32Array(u.faceDescriptor) : null,
      }));
    }
  } catch(e) { console.warn('Could not load users:', e); }

  try {
    const files = localStorage.getItem('medsecure_files');
    if (files) STATE.files = JSON.parse(files);
  } catch(e) { console.warn('Could not load files:', e); }

  try {
    const sessions = localStorage.getItem('medsecure_sessions');
    if (sessions) STATE.sessions = parseInt(sessions) || 0;
  } catch(e) {}
};

// ---- RPF FRAGMENT & STORE ----
window.generatePattern = function(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

window.storeFragments = function(fileId, fragments, pattern) {
  // fragments is array of ArrayBuffer (already permuted by pattern)
  fragments.forEach((frag, i) => {
    const storeName = STORE_NAMES[i % 3];
    const key = `${storeName}_${fileId}_${i}`;
    try {
      const b64 = arrayBufferToBase64(frag);
      localStorage.setItem(key, b64);
    } catch(e) {
      console.warn(`Failed to store fragment ${key}:`, e);
      toast(`Storage error: fragment ${i} too large?`, 'error');
    }
  });
};

window.retrieveFragments = function(fileId, fragmentCount, pattern) {
  // Returns array of ArrayBuffers in original order
  const shuffledFrags = [];
  for (let i = 0; i < fragmentCount; i++) {
    const storeName = STORE_NAMES[i % 3];
    const key = `${storeName}_${fileId}_${i}`;
    const b64 = localStorage.getItem(key);
    if (!b64) throw new Error(`Fragment ${i} missing from ${storeName}`);
    shuffledFrags.push(base64ToArrayBuffer(b64));
  }

  // Reconstruct: pattern[i] = original index that was placed at position i
  // So to reverse: put shuffledFrags[i] back at position pattern[i]
  const original = new Array(fragmentCount);
  pattern.forEach((origIdx, shuffledPos) => {
    original[origIdx] = shuffledFrags[shuffledPos];
  });

  return original;
};

window.deleteFragments = function(fileId, fragmentCount) {
  for (let i = 0; i < (fragmentCount || NUM_FRAGS); i++) {
    STORE_NAMES.forEach(store => {
      localStorage.removeItem(`${store}_${fileId}_${i}`);
    });
  }
};

window.fragmentBuffer = function(buffer, n, pattern) {
  const arr = new Uint8Array(buffer);
  const chunkSize = Math.ceil(arr.length / n);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, arr.length);
    chunks.push(arr.slice(start, end).buffer);
  }
  // Permute: position i in output gets chunk pattern[i]
  return pattern.map(i => chunks[i] || new ArrayBuffer(0));
};

// ---- PROCESS UPLOADED FILE ----
window.processFile = async function(file) {
  const id = 'FILE_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6).toUpperCase();
  addLog(`Processing: ${file.name} (${formatSize(file.size)})`, 'store');
  toast(`Fragmenting: ${file.name}...`, 'info', '⬡');

  const pattern = generatePattern(NUM_FRAGS);
  animateRPFDemo(file.name, file.size, NUM_FRAGS, pattern);

  const buffer = await readFileAsBuffer(file);
  const fragments = fragmentBuffer(buffer, NUM_FRAGS, pattern);

  storeFragments(id, fragments, pattern);

  const fileEntry = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    fragmentCount: NUM_FRAGS,
    pattern,
    uploadedAt: new Date().toLocaleString(),
  };

  STATE.files.push(fileEntry);
  persistFiles();
  updateDashboard();
  renderFiles();

  addLog(`Stored: ${file.name} → ${NUM_FRAGS} fragments (StoreA/B/C)`, 'store');
  toast(`${file.name} stored (${NUM_FRAGS} fragments)`, 'success', '🔒');
};

// ---- RETRIEVE ----
window.retrieveFile = async function(id) {
  const f = STATE.files.find(x => x.id === id);
  if (!f) { toast('File metadata not found', 'error'); return; }

  try {
    addLog(`Reassembling: ${f.name}`, 'store');
    toast(`Retrieving ${f.name}...`, 'info', '⬡');

    const originalFrags = retrieveFragments(f.id, f.fragmentCount, f.pattern);

    // Concatenate
    const totalSize = originalFrags.reduce((s, ab) => s + ab.byteLength, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    originalFrags.forEach(ab => {
      result.set(new Uint8Array(ab), offset);
      offset += ab.byteLength;
    });

    const blob = new Blob([result], { type: f.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);

    addLog(`Retrieved & downloaded: ${f.name}`, 'store');
    toast(`${f.name} downloaded!`, 'success');
  } catch(e) {
    toast(`Retrieval failed: ${e.message}`, 'error');
    addLog(`Retrieval error: ${e.message}`, 'error');
  }
};

// ---- DELETE ----
window.deleteFile = function(id) {
  const idx = STATE.files.findIndex(x => x.id === id);
  if (idx === -1) return;
  const f = STATE.files[idx];
  deleteFragments(f.id, f.fragmentCount);
  STATE.files.splice(idx, 1);
  persistFiles();
  renderFiles();
  updateDashboard();
  addLog(`Deleted: ${f.name}`, 'warn');
  toast(`${f.name} deleted`, 'warn', '🗑');
};

// ---- BINARY UTILS ----
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ---- DRAG & DROP ----
window.handleDragOver = function(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('dragover');
};
window.handleDragLeave = function() {
  document.getElementById('uploadZone').classList.remove('dragover');
};
window.handleDrop = function(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
};
window.handleFiles = async function(files) {
  for (const file of files) {
    await processFile(file);
  }
};