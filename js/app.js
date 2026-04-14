// ============================================================
// app.js — Global state, navigation, initialization
// ============================================================

window.STATE = {
  users: [],
  files: [],
  sessions: 0,
  currentUser: null,
  auditLog: [],

  // Registration state
  regFaceCaptured: false,
  regFaceDescriptor: null,
  regFaceAvatar: null,
  regFpCaptured: false,
  regWebAuthnId: null,
  regFaceInFrame: false,
  loginFaceDetected: false,
};

// ---- NAVIGATION ----
window.showPage = function(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button[data-page]').forEach(b => b.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  if (btn && btn.classList) btn.classList.add('active');
  if (id === 'dashboard') updateDashboard();
  if (id === 'users')     renderUsers();
  if (id === 'storage')   renderFiles();
  if (id === 'audit')     renderAudit();
};

window.switchAuthTab = function(tab, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('authTabLogin').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('authTabRegister').style.display = tab==='register' ? '' : 'none';
  if (tab !== 'login')    stopLoginCamera?.();
  if (tab !== 'register') stopRegCamera?.();
};

// ---- AWS CONFIG PAGE ----
window.renderAWSConfig = function() {
  const el = document.getElementById('awsConfigForm');
  if (!el) return;
  el.innerHTML = `
    <div style="background:rgba(255,165,2,0.07);border:1px solid rgba(255,165,2,0.25);border-radius:10px;padding:1.2rem;margin-bottom:1.5rem;font-size:0.8rem;font-family:'DM Mono',monospace;color:var(--text2)">
      <b style="color:var(--warn)">⚡ AWS S3 Setup</b><br><br>
      1. Create an S3 bucket (e.g. <code>medsecure-frags</code>)<br>
      2. Enable CORS on the bucket (allow PUT/GET/DELETE from your domain)<br>
      3. Create an IAM user with S3 read/write on that bucket<br>
      4. Enter credentials below — stored in localStorage (not sent anywhere else)
    </div>
    <div class="form-group">
      <label class="form-label">AWS Region</label>
      <input class="form-input" id="awsRegion" placeholder="ap-south-1" value="${AWS_CONFIG.region||''}">
    </div>
    <div class="form-group">
      <label class="form-label">S3 Bucket Name</label>
      <input class="form-input" id="awsBucket" placeholder="medsecure-fragments" value="${AWS_CONFIG.bucketName||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Access Key ID</label>
      <input class="form-input" id="awsKeyId" placeholder="AKIAIOSFODNN7EXAMPLE" value="${AWS_CONFIG.accessKeyId||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Secret Access Key</label>
      <input class="form-input" id="awsSecret" type="password" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" value="${AWS_CONFIG.secretAccessKey||''}">
    </div>
    <div style="margin-bottom:1rem;font-size:0.78rem;font-family:'DM Mono',monospace;color:var(--text2)">
      Required S3 CORS (paste in your bucket CORS config):<br>
      <pre style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:0.8rem;margin-top:0.5rem;font-size:0.7rem;color:var(--accent3);overflow-x:auto">[{"AllowedHeaders":["*"],"AllowedMethods":["GET","PUT","DELETE"],"AllowedOrigins":["*"],"ExposeHeaders":[]}]</pre>
    </div>
    <div style="display:flex;gap:0.8rem">
      <button class="btn btn-primary" onclick="applyAWSConfig()">☁ Enable AWS S3</button>
      <button class="btn btn-secondary" onclick="useLocalStorage()">💾 Use localStorage</button>
      <button class="btn btn-secondary" onclick="testAWSConnection()">⚡ Test Connection</button>
    </div>
    <div id="awsTestResult" style="margin-top:1rem;font-size:0.78rem;font-family:'DM Mono',monospace"></div>
  `;
};

window.applyAWSConfig = function() {
  const region   = document.getElementById('awsRegion')?.value.trim();
  const bucket   = document.getElementById('awsBucket')?.value.trim();
  const keyId    = document.getElementById('awsKeyId')?.value.trim();
  const secret   = document.getElementById('awsSecret')?.value.trim();
  if (!region||!bucket||!keyId||!secret) { toast('Fill in all AWS fields', 'error'); return; }
  saveAWSConfig({ region, bucketName:bucket, accessKeyId:keyId, secretAccessKey:secret });
  updateDashboard();
};

window.testAWSConnection = async function() {
  const res = document.getElementById('awsTestResult');
  if (res) res.innerHTML = '<span style="color:var(--text2)">Testing...</span>';
  try {
    applyAWSConfig();
    // Try to PUT a small test object
    const testId = 'CONN_TEST_' + Date.now();
    const testData = new TextEncoder().encode('medsecure-connection-test').buffer;
    await window.processFile(new File([testData], '_test.txt', {type:'text/plain'}));
    if (res) res.innerHTML = '<span style="color:var(--accent3)">✓ S3 connection successful!</span>';
  } catch(e) {
    if (res) res.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
  }
};

// ---- INIT ----
window.addEventListener('DOMContentLoaded', async () => {
  loadFromStorage();

  // Load audit log
  try {
    const audit = localStorage.getItem('medsecure_audit');
    if (audit) STATE.auditLog = JSON.parse(audit);
  } catch(e) {}

  updateDashboard();
  updateStorageModeUI();

  // Clock
  const updateClock = () => {
    const el = document.getElementById('systemStatus');
    if (el) el.textContent = 'System Online — ' + new Date().toTimeString().slice(0,5);
  };
  updateClock();
  setInterval(updateClock, 10000);

  addLog('MedSecure initialized — loading AI models...', 'store');
  addLog(`${STATE.users.length} users | ${STATE.files.length} files | backend: ${AWS_CONFIG.mode}`, 'info');

  await loadFaceModels();
  addLog(`Ready | ${STATE.users.length} enrolled users`, 'auth');
});

// ---- MISC GLOBALS ----
window.clearAllUsers = function() {
  if (!can('canRegisterUsers')) { toast('Only Admin can clear users', 'error'); return; }
  if (!confirm('Delete ALL users? Cannot be undone.')) return;
  STATE.users = [];
  persistUsers();
  renderUsers();
  updateDashboard();
  toast('All users cleared', 'warn');
  addLog('All user profiles deleted', 'warn');
};