// ============================================================
// storage.js — RPF Fragmentation + AWS S3 / localStorage backend
// ============================================================

const STORE_NAMES = ['StoreA', 'StoreB', 'StoreC'];
const NUM_FRAGS = 8;

// Per-store AWS config — each store has its own bucket and credentials
window.STORE_CONFIGS = {
  StoreA: { region: '', bucketName: '', accessKeyId: '', secretAccessKey: '', configured: false },
  StoreB: { region: '', bucketName: '', accessKeyId: '', secretAccessKey: '', configured: false },
  StoreC: { region: '', bucketName: '', accessKeyId: '', secretAccessKey: '', configured: false },
};

// mode is global: 'local' or 'aws'
window.AWS_CONFIG = { mode: 'local' };

try {
  const saved = localStorage.getItem('medsecure_aws_config');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.mode) AWS_CONFIG.mode = parsed.mode;
    if (parsed.stores) Object.assign(STORE_CONFIGS, parsed.stores);
  }
} catch(e) {}

// ---- PERSIST METADATA ----
window.persistUsers = function() {
  try {
    const serializable = STATE.users.map(u => ({
      ...u,
      faceDescriptor: u.faceDescriptor ? Array.from(u.faceDescriptor) : null,
    }));
    localStorage.setItem('medsecure_users', JSON.stringify(serializable));
  } catch(e) {
    toast('localStorage quota exceeded', 'warn');
  }
};

window.persistFiles = function() {
  try {
    const meta = STATE.files.map(f => ({
      id: f.id, name: f.name, size: f.size, type: f.type,
      fragmentCount: f.fragmentCount, pattern: f.pattern,
      uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy,
      uploadedByName: f.uploadedByName, storageBackend: f.storageBackend,
      sharedWith: f.sharedWith || [],
    }));
    localStorage.setItem('medsecure_files', JSON.stringify(meta));
  } catch(e) {}
};

window.persistSessions = function() {
  localStorage.setItem('medsecure_sessions', String(STATE.sessions));
};

window.saveAWSConfig = function(stores) {
  Object.assign(STORE_CONFIGS, stores);
  // Mark each store as configured if all fields are filled
  ['StoreA','StoreB','StoreC'].forEach(s => {
    const c = STORE_CONFIGS[s];
    c.configured = !!(c.region && c.bucketName && c.accessKeyId && c.secretAccessKey);
  });
  AWS_CONFIG.mode = 'aws';
  localStorage.setItem('medsecure_aws_config', JSON.stringify({ mode: 'aws', stores: STORE_CONFIGS }));
  toast('AWS configuration saved!', 'success');
  ['StoreA','StoreB','StoreC'].forEach(s =>
    addLog(`${s} → s3://${STORE_CONFIGS[s].bucketName} (${STORE_CONFIGS[s].region})`, 'store')
  );
  updateStorageModeUI();
};

window.useLocalStorage = function() {
  AWS_CONFIG.mode = 'local';
  localStorage.setItem('medsecure_aws_config', JSON.stringify({ mode: 'local', stores: STORE_CONFIGS }));
  toast('Switched to localStorage mode', 'info');
  addLog('Storage backend: localStorage (demo mode)', 'warn');
  updateStorageModeUI();
};

window.updateStorageModeUI = function() {
  const badge = document.getElementById('storageBadge');
  if (!badge) return;
  const allConfigured = ['StoreA','StoreB','StoreC'].every(s => STORE_CONFIGS[s].configured);
  if (AWS_CONFIG.mode === 'aws' && allConfigured) {
    badge.innerHTML = '☁ AWS S3 (3 Buckets)';
    badge.style.cssText = 'background:rgba(255,165,2,0.15);color:var(--warn);padding:3px 10px;border-radius:20px;font-size:0.7rem;font-family:DM Mono,monospace;display:inline-flex;align-items:center;gap:4px';
  } else {
    badge.innerHTML = '💾 localStorage';
    badge.style.cssText = 'background:rgba(0,212,255,0.1);color:var(--accent);padding:3px 10px;border-radius:20px;font-size:0.7rem;font-family:DM Mono,monospace;display:inline-flex;align-items:center;gap:4px';
  }
};

// ---- LOAD ----
window.loadFromStorage = function() {
  try {
    const users = localStorage.getItem('medsecure_users');
    if (users) STATE.users = JSON.parse(users).map(u => ({
      ...u,
      faceDescriptor: u.faceDescriptor ? new Float32Array(u.faceDescriptor) : null,
    }));
  } catch(e) {}

  try {
    const files = localStorage.getItem('medsecure_files');
    if (files) STATE.files = JSON.parse(files);
  } catch(e) {}

  try {
    const sessions = localStorage.getItem('medsecure_sessions');
    if (sessions) STATE.sessions = parseInt(sessions) || 0;
  } catch(e) {}
};

// ---- RPF CORE ----
window.generatePattern = function(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
  return pattern.map(i => chunks[i] || new ArrayBuffer(0));
};

// ---- LOCAL BACKEND ----
function localStore(fileId, fragments) {
  fragments.forEach((frag, i) => {
    const key = `${STORE_NAMES[i % 3]}_${fileId}_${i}`;
    localStorage.setItem(key, arrayBufferToBase64(frag));
  });
}

function localRetrieve(fileId, fragmentCount, pattern) {
  const shuffled = [];
  for (let i = 0; i < fragmentCount; i++) {
    const key = `${STORE_NAMES[i % 3]}_${fileId}_${i}`;
    const b64 = localStorage.getItem(key);
    if (!b64) throw new Error(`Fragment ${i} missing from ${STORE_NAMES[i%3]}`);
    shuffled.push(base64ToArrayBuffer(b64));
  }
  const original = new Array(fragmentCount);
  pattern.forEach((origIdx, pos) => { original[origIdx] = shuffled[pos]; });
  return original;
}

function localDelete(fileId, fragmentCount) {
  for (let i = 0; i < (fragmentCount || NUM_FRAGS); i++)
    STORE_NAMES.forEach(s => localStorage.removeItem(`${s}_${fileId}_${i}`));
}

// ---- AWS S3 BACKEND (Signature v4, no SDK needed) ----
async function s3Put(fileId, fragIndex, data) {
  const storeName = STORE_NAMES[fragIndex % 3];
  const cfg = STORE_CONFIGS[storeName];
  const key = `medsecure/${storeName}/${fileId}/${fragIndex}`;
  const url = await signS3('PUT', key, cfg);
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  });
  if (!resp.ok) throw new Error(`S3 PUT failed [${resp.status}]: ${await resp.text()}`);
}

async function s3Get(fileId, fragIndex) {
  const storeName = STORE_NAMES[fragIndex % 3];
  const cfg = STORE_CONFIGS[storeName];
  const key = `medsecure/${storeName}/${fileId}/${fragIndex}`;
  const url = await signS3('GET', key, cfg);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`S3 GET failed [${resp.status}]`);
  return await resp.arrayBuffer();
}

async function s3Delete(fileId, fragIndex) {
  const storeName = STORE_NAMES[fragIndex % 3];
  const cfg = STORE_CONFIGS[storeName];
  const key = `medsecure/${storeName}/${fileId}/${fragIndex}`;
  const url = await signS3('DELETE', key, cfg);
  await fetch(url, { method: 'DELETE' });
}

async function signS3(method, key, cfg) {
  const { region, bucketName, accessKeyId, secretAccessKey } = cfg;
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzdate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0,15) + 'Z';
  const datestamp = amzdate.slice(0,8);
  const expires = '3600';
  const credential = `${accessKeyId}/${datestamp}/${region}/s3/aws4_request`;

  const qs = new URLSearchParams({
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    credential,
    'X-Amz-Date':          amzdate,
    'X-Amz-Expires':       expires,
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalReq = [method, '/' + key, qs.toString(), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzdate, `${datestamp}/${region}/s3/aws4_request`, await sha256Hex(canonicalReq)].join('\n');
  const sigKey = await getSigningKey(secretAccessKey, datestamp, region);
  const sig = await hmacHex(sigKey, sts);
  qs.set('X-Amz-Signature', sig);
  return `https://${host}/${key}?${qs}`;
}

async function sha256Hex(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function hmacSha256(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key==='string'?new TextEncoder().encode(key):key, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, typeof msg==='string'?new TextEncoder().encode(msg):msg);
}
async function hmacHex(key, msg) {
  return [...new Uint8Array(await hmacSha256(key,msg))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function getSigningKey(secret, date, region) {
  const kD = await hmacSha256('AWS4'+secret, date);
  const kR = await hmacSha256(kD, region);
  const kS = await hmacSha256(kR, 's3');
  return hmacSha256(kS, 'aws4_request');
}

// ---- UNIFIED API ----
function isAwsReady() {
  return AWS_CONFIG.mode === 'aws' && ['StoreA','StoreB','StoreC'].every(s => STORE_CONFIGS[s].configured);
}

async function storeFragments(fileId, fragments) {
  if (isAwsReady()) {
    await Promise.all(fragments.map((f,i) => s3Put(fileId, i, f)));
  } else {
    localStore(fileId, fragments);
  }
}

async function retrieveFragments(fileId, count, pattern) {
  if (isAwsReady()) {
    const shuffled = await Promise.all(Array.from({length:count},(_,i)=>s3Get(fileId,i)));
    const original = new Array(count);
    pattern.forEach((origIdx, pos) => { original[origIdx] = shuffled[pos]; });
    return original;
  }
  return localRetrieve(fileId, count, pattern);
}

async function deleteFragments(fileId, count) {
  if (isAwsReady()) {
    await Promise.all(Array.from({length:count},(_,i)=>s3Delete(fileId,i)));
  } else {
    localDelete(fileId, count);
  }
}

// ---- PUBLIC FILE OPS ----
window.processFile = async function(file) {
  if (!STATE.currentUser) { toast('Please authenticate first', 'error'); return; }
  if (!can('canUploadFiles')) { toast(`${STATE.currentUser.role}s cannot upload files`, 'error'); return; }

  const id = 'FILE_' + Date.now() + '_' + Math.random().toString(36).slice(2,6).toUpperCase();
  addLog(`Processing: ${file.name} (${formatSize(file.size)}) → ${AWS_CONFIG.mode.toUpperCase()}`, 'store');
  toast(`Fragmenting ${file.name}...`, 'info', '⬡');

  const pattern = generatePattern(NUM_FRAGS);
  animateRPFDemo(file.name, file.size, NUM_FRAGS, pattern);

  try {
    const buffer = await readFileAsBuffer(file);
    const fragments = fragmentBuffer(buffer, NUM_FRAGS, pattern);
    await storeFragments(id, fragments);

    STATE.files.push({
      id, name: file.name, size: file.size,
      type: file.type || 'application/octet-stream',
      fragmentCount: NUM_FRAGS, pattern,
      uploadedAt: new Date().toLocaleString(),
      uploadedBy: STATE.currentUser.id,
      uploadedByName: STATE.currentUser.name,
      storageBackend: AWS_CONFIG.mode,
      sharedWith: [],
    });

    persistFiles();
    updateDashboard();
    renderFiles();

    const backend = isAwsReady() ? 'AWS S3 (3 Buckets)' : 'localStorage';
    addLog(`✓ ${file.name} → ${NUM_FRAGS} frags in ${backend}`, 'store');
    toast(`${file.name} stored in ${backend}!`, 'success', '🔒');
  } catch(e) {
    toast(`Upload failed: ${e.message}`, 'error');
    addLog(`Upload error: ${e.message}`, 'error');
    console.error(e);
  }
};

window.retrieveFile = async function(id) {
  const f = STATE.files.find(x => x.id === id);
  if (!f) return;
  if (!canAccessFile(f)) { toast('Access denied — insufficient permissions', 'error'); return; }

  try {
    toast(`Retrieving ${f.name}...`, 'info', '⬡');
    const frags = await retrieveFragments(f.id, f.fragmentCount, f.pattern);
    const total = frags.reduce((s,ab) => s+ab.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    frags.forEach(ab => { result.set(new Uint8Array(ab), offset); offset += ab.byteLength; });
    const blob = new Blob([result], { type: f.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.click();
    URL.revokeObjectURL(url);
    addLog(`✓ Retrieved: ${f.name}`, 'store');
    toast(`${f.name} downloaded!`, 'success');
  } catch(e) {
    toast(`Retrieval failed: ${e.message}`, 'error');
    addLog(`Retrieval error: ${e.message}`, 'error');
  }
};

window.deleteFile = async function(id) {
  const f = STATE.files.find(x => x.id === id);
  if (!f) return;
  if (!canDeleteFile(f)) { toast('Access denied — cannot delete this file', 'error'); return; }
  if (!confirm(`Delete "${f.name}"? Cannot be undone.`)) return;
  try {
    await deleteFragments(f.id, f.fragmentCount);
    STATE.files = STATE.files.filter(x => x.id !== id);
    persistFiles();
    renderFiles();
    updateDashboard();
    addLog(`Deleted: ${f.name}`, 'warn');
    toast(`${f.name} deleted`, 'warn', '🗑');
  } catch(e) {
    toast(`Delete failed: ${e.message}`, 'error');
  }
};

window.shareFileWithPatient = function(fileId, patientId) {
  const f = STATE.files.find(x => x.id === fileId);
  if (!f) return;
  if (!f.sharedWith) f.sharedWith = [];
  if (!f.sharedWith.includes(patientId)) f.sharedWith.push(patientId);
  persistFiles();
  toast('File shared with patient', 'success');
  renderFiles();
};

// ---- DRAG & DROP ----
window.handleDragOver = e => { e.preventDefault(); document.getElementById('uploadZone')?.classList.add('dragover'); };
window.handleDragLeave = () => document.getElementById('uploadZone')?.classList.remove('dragover');
window.handleDrop = e => { e.preventDefault(); document.getElementById('uploadZone')?.classList.remove('dragover'); handleFiles(e.dataTransfer.files); };
window.handleFiles = async function(files) { for (const f of files) await processFile(f); };

// ---- BINARY ----
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i+8192));
  return btoa(bin);
}
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
window.readFileAsBuffer = file => new Promise((res,rej) => {
  const r = new FileReader();
  r.onload = e => res(e.target.result);
  r.onerror = rej;
  r.readAsArrayBuffer(file);
});

window.getStorageStats = function() {
  let lsSize = 0;
  try { for (let k in localStorage) if (k.startsWith('medsecure')||k.startsWith('Store')) lsSize += (localStorage[k]||'').length*2; } catch(e) {}
  return {
    totalFiles: STATE.files.length,
    totalBytes: STATE.files.reduce((s,f)=>s+(f.size||0),0),
    totalFrags: STATE.files.reduce((s,f)=>s+(f.fragmentCount||0),0),
    lsSize,
    backend: isAwsReady() ? 'aws' : 'local',
  };
};