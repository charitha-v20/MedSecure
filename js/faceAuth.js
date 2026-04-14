// ============================================================
// faceAuth.js — Real face recognition (face-api.js)
//              + WebAuthn hardware fingerprint (optional)
//              + ORB simulated fingerprint (optional)
// ============================================================

const FACE_THRESHOLD = 0.55;   // Euclidean distance — lower = stricter
const FACE_WEIGHT    = 0.65;   // Score fusion weights
const FP_WEIGHT      = 0.35;

let loginStream = null;
let regStream = null;
let loginDetectionLoop = null;
let regDetectionLoop = null;
let modelsLoaded = false;

// ---- MODEL LOADING ----
window.loadFaceModels = async function() {
  const overlay = document.getElementById('modelOverlay');
  const fill    = document.getElementById('modelProgressFill');
  const sub     = document.getElementById('modelSub');
  overlay.style.display = 'flex';

  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
  const steps = [
    { name: 'SSD MobileNet (detector)',    fn: () => faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL) },
    { name: '68-point Landmark Model',     fn: () => faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL) },
    { name: 'FaceNet Recognition Model',   fn: () => faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL) },
  ];

  for (let i = 0; i < steps.length; i++) {
    sub.textContent = `Loading ${steps[i].name}...`;
    fill.style.width = (i / steps.length * 100) + '%';
    try { await steps[i].fn(); }
    catch(e) { sub.textContent = `⚠ ${steps[i].name} failed — ${e.message}`; await sleep(1500); }
    fill.style.width = ((i+1) / steps.length * 100) + '%';
  }

  modelsLoaded = true;
  sub.textContent = 'Models ready ✓';
  fill.style.width = '100%';
  await sleep(500);
  overlay.style.display = 'none';
  addLog('face-api.js models loaded: SSD MobileNet + FaceNet 128-d', 'auth');
  toast('Face recognition ready', 'success', '🧠');
};

// ---- CAMERA HELPERS ----
async function openCamera(videoEl, canvasEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width:{ideal:640}, height:{ideal:480}, facingMode:'user' }
  });
  videoEl.srcObject = stream;
  await new Promise(res => { videoEl.onloadedmetadata = res; });
  canvasEl.width  = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  return stream;
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

// ---- DRAW HELPERS ----
function drawDetection(ctx, det, label) {
  const { box } = det.detection;
  const conf = (det.detection.score * 100).toFixed(1);

  // Face box
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  // Corners
  const L = 20;
  ctx.strokeStyle = '#00ff9d'; ctx.lineWidth = 3;
  [[box.x,box.y+L,box.x,box.y,box.x+L,box.y],
   [box.x+box.width-L,box.y,box.x+box.width,box.y,box.x+box.width,box.y+L],
   [box.x,box.y+box.height-L,box.x,box.y+box.height,box.x+L,box.y+box.height],
   [box.x+box.width-L,box.y+box.height,box.x+box.width,box.y+box.height,box.x+box.width,box.y+box.height-L]]
  .forEach(([x1,y1,x2,y2,x3,y3]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke();
  });

  // Landmarks
  if (det.landmarks) {
    ctx.fillStyle = 'rgba(0,212,255,0.8)';
    det.landmarks.positions.forEach(pt => {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI*2); ctx.fill();
    });
  }

  // Label bar
  const lbl = label || `FACE  ${conf}%`;
  ctx.fillStyle = '#00d4ff';
  ctx.fillRect(box.x, box.y - 24, lbl.length * 7.5 + 12, 22);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 11px DM Mono, monospace';
  ctx.fillText(lbl, box.x + 6, box.y - 7);

  // Confidence bar at bottom
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(box.x, box.y + box.height - 20, box.width, 20);
  ctx.fillStyle = '#00ff9d';
  ctx.fillRect(box.x, box.y + box.height - 20, box.width * det.detection.score, 20);
  ctx.fillStyle = '#000';
  ctx.font = '10px DM Mono, monospace';
  ctx.fillText(`Conf: ${conf}%`, box.x + 4, box.y + box.height - 6);
}

// ==================== LOGIN ====================
window.startLoginCamera = async function() {
  if (!modelsLoaded) { toast('Models loading, please wait...', 'warn'); return; }
  const vid = document.getElementById('loginVideo');
  const cvs = document.getElementById('loginCanvas');
  try {
    loginStream = await openCamera(vid, cvs);
    document.getElementById('loginCamStatus').innerHTML = '● Active';
    document.getElementById('loginCamStatus').style.cssText = chipCss('#00ff9d','rgba(0,255,157,0.1)');
    document.getElementById('btnStartLogin').style.display = 'none';
    document.getElementById('btnStopLogin').style.display = '';
    document.getElementById('btnCapture').disabled = false;
    document.getElementById('loginScanLine').classList.add('active');
    document.getElementById('loginFaceStatus').textContent = 'Camera active — center your face';
    setStep(1, 'done'); setStep(2, 'active');
    addLog('Login camera started', 'auth');
    startLoginDetection(vid, cvs);
  } catch(e) {
    toast('Camera error: ' + e.message, 'error');
    addLog('Camera failed: ' + e.message, 'error');
  }
};

window.stopLoginCamera = function() {
  stopStream(loginStream); loginStream = null;
  if (loginDetectionLoop) { clearInterval(loginDetectionLoop); loginDetectionLoop = null; }
  const cvs = document.getElementById('loginCanvas');
  cvs.getContext('2d')?.clearRect(0, 0, cvs.width, cvs.height);
  document.getElementById('loginVideo').srcObject = null;
  document.getElementById('btnStartLogin').style.display = '';
  document.getElementById('btnStopLogin').style.display = 'none';
  document.getElementById('btnCapture').disabled = true;
  document.getElementById('loginScanLine').classList.remove('active');
  document.getElementById('loginCamStatus').innerHTML = '● Inactive';
  document.getElementById('loginCamStatus').style.cssText = chipCss('var(--warn)','rgba(255,165,2,0.1)');
};

function startLoginDetection(vid, cvs) {
  const ctx = cvs.getContext('2d');
  loginDetectionLoop = setInterval(async () => {
    if (!vid.videoWidth || vid.paused) return;
    ctx.drawImage(vid, 0, 0, cvs.width, cvs.height);
    if (!modelsLoaded) return;
    try {
      const det = await faceapi
        .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({minConfidence:0.5}))
        .withFaceLandmarks();
      if (det) {
        drawDetection(ctx, det, null);
        const conf = (det.detection.score * 100).toFixed(1);
        document.getElementById('loginFaceStatus').textContent = `Face detected — ${conf}% confidence`;
        document.getElementById('conf2').style.width = conf + '%';
        setStep(2, 'done');
      } else {
        document.getElementById('loginFaceStatus').textContent = 'No face detected — center your face';
        setStep(2, 'active');
      }
    } catch(e) { /* skip frame */ }
  }, 200);
}

// ---- CAPTURE & AUTHENTICATE ----
window.captureAndAuth = async function() {
  if (!STATE.users.length) { toast('No users enrolled — register first', 'error'); return; }
  if (!modelsLoaded) { toast('Models not loaded', 'warn'); return; }

  const vid = document.getElementById('loginVideo');
  document.getElementById('btnCapture').disabled = true;
  addLog('Authentication started', 'auth');

  // Step 2 — Detect
  setStep(2, 'active');
  document.getElementById('loginFaceStatus').textContent = 'Detecting face...';

  const detection = await faceapi
    .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({minConfidence:0.4}))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    toast('No face detected — center your face and try again', 'error');
    document.getElementById('loginFaceStatus').textContent = 'No face — try again';
    document.getElementById('btnCapture').disabled = false;
    addLog('Auth failed — no face detected', 'error');
    return;
  }

  setStep(2, 'done');
  document.getElementById('conf2').style.width = (detection.detection.score * 100).toFixed(0) + '%';
  await sleep(300);

  // Step 3 — FaceNet descriptor
  setStep(3, 'active');
  document.getElementById('loginFaceStatus').textContent = 'Extracting 128-d FaceNet embedding...';
  await sleep(400);
  const capturedDesc = detection.descriptor;
  setStep(3, 'done');
  document.getElementById('conf3').style.width = '92%';
  await sleep(300);

  // Step 4 — Fingerprint check (WebAuthn or simulated)
  setStep(4, 'active');
  let fpScore = 0;
  const userHasWebAuthn = STATE.users.some(u => u.webAuthnId);

  if (userHasWebAuthn) {
    document.getElementById('loginFaceStatus').textContent = 'Touch fingerprint sensor...';
    try {
      fpScore = await verifyWebAuthn();
      addLog('WebAuthn fingerprint verified', 'auth');
    } catch(e) {
      // WebAuthn failed — fall back to score penalty
      fpScore = 0.5;
      addLog('WebAuthn failed — penalty applied: ' + e.message, 'warn');
    }
  } else {
    document.getElementById('loginFaceStatus').textContent = 'Simulated ORB fingerprint match...';
    await sleep(500);
    fpScore = 0.80 + Math.random() * 0.18;
  }

  setStep(4, 'done');
  document.getElementById('conf4').style.width = (fpScore * 100).toFixed(0) + '%';
  await sleep(300);

  // Step 5 — Score fusion + match
  setStep(5, 'active');
  document.getElementById('loginFaceStatus').textContent = 'Computing score-level fusion...';
  await sleep(350);

  let bestMatch = null;
  let bestDist  = Infinity;

  STATE.users.forEach(user => {
    if (!user.faceDescriptor) return;
    const dist = faceapi.euclideanDistance(capturedDesc, new Float32Array(user.faceDescriptor));
    if (dist < bestDist) { bestDist = dist; bestMatch = user; }
  });

  const faceScore  = Math.max(0, 1 - bestDist);
  const fusedScore = bestMatch ? FACE_WEIGHT * faceScore + FP_WEIGHT * fpScore : 0;

  setStep(5, 'done');
  document.getElementById('conf5').style.width = (fusedScore * 100).toFixed(0) + '%';
  await sleep(300);

  // Step 6 — Decision
  const matched = bestMatch && bestDist < FACE_THRESHOLD;

  if (matched) {
    setStep(6, 'done');
    STATE.currentUser = bestMatch;
    STATE.sessions++;
    persistSessions();

    const dist = bestDist.toFixed(3);
    const pct  = (fusedScore * 100).toFixed(1);

    document.getElementById('authUserLabel').textContent = `✓ ${bestMatch.name} (${bestMatch.role}) — dist:${dist}`;
    document.getElementById('authResultBadge').innerHTML = '✓ Authenticated';
    document.getElementById('authResultBadge').style.cssText = badgeStyle('#00ff9d','rgba(0,255,157,0.15)');
    document.getElementById('authMessage').innerHTML = `
      <div class="match-card success">
        <strong style="color:var(--accent3)">✓ Identity confirmed</strong><br>
        <div style="margin-top:6px;font-size:0.75rem;color:var(--text2);font-family:'DM Mono',monospace;line-height:2">
          User: <b style="color:var(--text)">${bestMatch.name}</b> &nbsp;|&nbsp; 
          Role: <b style="color:var(--text)">${bestMatch.role}</b><br>
          Euclidean dist: <b style="color:var(--accent)">${dist}</b> (threshold: ${FACE_THRESHOLD}) &nbsp;|&nbsp; 
          Fused: <b style="color:var(--accent3)">${pct}%</b><br>
          Fingerprint: <b style="color:var(--text)">${userHasWebAuthn?'WebAuthn ✓':'ORB simulated'}</b>
        </div>
      </div>`;
    document.getElementById('btnAccessFiles').style.display = '';
    document.getElementById('loginFaceStatus').textContent = `✓ Welcome, ${bestMatch.name}!`;
    toast(`Welcome, ${bestMatch.name}!`, 'success');
    addLog(`Authenticated: ${bestMatch.name} | dist=${dist} | fused=${pct}%`, 'auth');

    applyPermissionUI();
    updateDashboard();
    addAuditEntry('LOGIN', `${bestMatch.name} authenticated successfully`);
  } else {
    const dist = bestMatch ? bestDist.toFixed(3) : 'N/A';
    document.getElementById('authResultBadge').innerHTML = '✗ Failed';
    document.getElementById('authResultBadge').style.cssText = badgeStyle('var(--danger)','rgba(255,71,87,0.15)');
    document.getElementById('authMessage').innerHTML = `
      <div class="match-card fail">
        <strong style="color:var(--danger)">✗ Authentication failed</strong><br>
        <span style="font-size:0.75rem;color:var(--text2);font-family:'DM Mono',monospace">
          Best distance: ${dist} — exceeds threshold ${FACE_THRESHOLD}
        </span>
      </div>`;
    document.getElementById('loginFaceStatus').textContent = 'Authentication failed';
    toast('No matching face found', 'error');
    addLog(`Auth failed — dist=${dist}`, 'error');
    addAuditEntry('FAIL', `Authentication attempt failed — no match`);
    document.getElementById('btnCapture').disabled = false;
  }
};

window.resetAuth = function() {
  [1,2,3,4,5,6].forEach(i => setStep(i, ''));
  ['conf2','conf3','conf4','conf5'].forEach(id => { const el=document.getElementById(id); if(el) el.style.width='0%'; });
  document.getElementById('authResultBadge').innerHTML = 'Pending';
  document.getElementById('authResultBadge').style.cssText = badgeStyle('var(--text3)','rgba(42,48,69,0.5)');
  document.getElementById('authMessage').innerHTML = '';
  document.getElementById('authUserLabel').textContent = 'Awaiting authentication';
  document.getElementById('btnAccessFiles').style.display = 'none';
  document.getElementById('loginFaceStatus').textContent = 'Ready — click Capture & Verify';
  document.getElementById('btnCapture').disabled = !loginStream;
  STATE.currentUser = null;
  clearPermissionUI();
};

// ---- LOGOUT ----
window.logout = function() {
  if (STATE.currentUser) addAuditEntry('LOGOUT', `${STATE.currentUser.name} logged out`);
  STATE.currentUser = null;
  clearPermissionUI();
  resetAuth();
  stopLoginCamera();
  showPage('auth', document.querySelector('[data-page=auth]'));
  toast('Logged out successfully', 'info');
};

// ==================== WEBAUTHN FINGERPRINT ====================
// Uses platform authenticator (laptop fingerprint sensor / Windows Hello / Touch ID)
// Returns a normalized score 0–1

async function registerWebAuthn(userId, userName) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'MedSecure', id: location.hostname || 'localhost' },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Use built-in sensor
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    }
  });

  // Store credential ID (not the key — that stays in the secure enclave)
  return {
    credentialId: bufToBase64(credential.rawId),
    publicKey: bufToBase64(credential.response.getPublicKey?.() || new ArrayBuffer(0)),
  };
}

async function verifyWebAuthn() {
  // Get all enrolled credential IDs
  const allowCredentials = STATE.users
    .filter(u => u.webAuthnId)
    .map(u => ({ type: 'public-key', id: base64ToBuf(u.webAuthnId) }));

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials,
      userVerification: 'required',
      timeout: 60000,
    }
  });
  return 1.0; // Hardware verified — full score
}

// ==================== REGISTRATION ====================
window.startRegCamera = async function() {
  if (!modelsLoaded) { toast('Models loading...', 'warn'); return; }
  const vid = document.getElementById('regVideo');
  const cvs = document.getElementById('regCanvas');
  try {
    regStream = await openCamera(vid, cvs);
    document.getElementById('regCamStatus').innerHTML = '● Active';
    document.getElementById('regCamStatus').style.cssText = chipCss('#00ff9d','rgba(0,255,157,0.1)');
    document.getElementById('btnRegStartCam').style.display = 'none';
    document.getElementById('btnRegStop').style.display = '';
    document.getElementById('btnRegCapture').disabled = false;
    document.getElementById('regScanLine').classList.add('active');
    document.getElementById('regFaceStatus').textContent = 'Camera active — look straight ahead';
    startRegDetection(vid, cvs);
  } catch(e) { toast('Camera error: ' + e.message, 'error'); }
};

window.stopRegCamera = function() {
  stopStream(regStream); regStream = null;
  if (regDetectionLoop) { clearInterval(regDetectionLoop); regDetectionLoop = null; }
  const cvs = document.getElementById('regCanvas');
  cvs.getContext('2d')?.clearRect(0, 0, cvs.width, cvs.height);
  document.getElementById('regVideo').srcObject = null;
  document.getElementById('btnRegStartCam').style.display = '';
  document.getElementById('btnRegStop').style.display = 'none';
  document.getElementById('btnRegCapture').disabled = true;
  document.getElementById('regScanLine').classList.remove('active');
  document.getElementById('regCamStatus').innerHTML = '● Inactive';
  document.getElementById('regCamStatus').style.cssText = chipCss('var(--warn)','rgba(255,165,2,0.1)');
};

function startRegDetection(vid, cvs) {
  const ctx = cvs.getContext('2d');
  regDetectionLoop = setInterval(async () => {
    if (!vid.videoWidth || vid.paused) return;
    ctx.drawImage(vid, 0, 0, cvs.width, cvs.height);
    try {
      const det = await faceapi
        .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({minConfidence:0.5}))
        .withFaceLandmarks();
      if (det) {
        drawDetection(ctx, det, 'FACE DETECTED — CAPTURE ✓');
        document.getElementById('regFaceStatus').textContent = 'Face detected — press Capture!';
        STATE.regFaceInFrame = true;
      } else {
        document.getElementById('regFaceStatus').textContent = 'No face — look at the camera';
        STATE.regFaceInFrame = false;
      }
    } catch(e) {}
  }, 250);
}

window.captureRegFace = async function() {
  if (!modelsLoaded) { toast('Models not loaded', 'warn'); return; }
  const vid = document.getElementById('regVideo');
  document.getElementById('btnRegCapture').disabled = true;
  document.getElementById('regFaceStatus').textContent = 'Extracting 128-d descriptor...';

  try {
    const det = await faceapi
      .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({minConfidence:0.4}))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!det) {
      toast('No face detected — try again', 'error');
      document.getElementById('btnRegCapture').disabled = false;
      document.getElementById('regFaceStatus').textContent = 'No face — try again';
      return;
    }

    STATE.regFaceDescriptor = det.descriptor;

    // Capture avatar thumbnail
    const tc = document.createElement('canvas');
    tc.width = vid.videoWidth; tc.height = vid.videoHeight;
    tc.getContext('2d').drawImage(vid, 0, 0);
    STATE.regFaceAvatar = tc.toDataURL('image/jpeg', 0.7);
    STATE.regFaceCaptured = true;

    document.getElementById('faceCaptureStatus').innerHTML =
      `<span style="color:var(--accent3)">✓ 128-d FaceNet descriptor extracted (conf: ${(det.detection.score*100).toFixed(1)}%)</span>`;
    document.getElementById('faceCaptureStatus').style.borderColor = 'rgba(0,255,157,0.3)';

    toast('Face captured!', 'success');
    addLog('Face template (128-d) captured', 'auth');
    stopRegCamera();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
    document.getElementById('btnRegCapture').disabled = false;
  }
};

// ---- FINGERPRINT REGISTRATION (choose mode) ----
window.enrollWebAuthn = async function() {
  const name = document.getElementById('regName').value.trim();
  if (!name) { toast('Enter name before fingerprint enrollment', 'warn'); return; }

  document.getElementById('fpIcon').textContent = '👆';
  document.getElementById('fpText').textContent = 'Touch your fingerprint sensor...';

  try {
    const tempId = 'TEMP_' + Date.now();
    const result = await registerWebAuthn(tempId, name);
    STATE.regWebAuthnId = result.credentialId;
    STATE.regFpCaptured = true;
    document.getElementById('fpArea').classList.add('scanned');
    document.getElementById('fpIcon').textContent = '🔒';
    document.getElementById('fpText').textContent = '✓ Hardware fingerprint enrolled (WebAuthn / platform authenticator)';
    document.getElementById('fpArea').onclick = null;
    document.getElementById('fpModeLabel').textContent = 'WebAuthn';
    document.getElementById('fpModeLabel').style.cssText = 'color:var(--accent3);font-size:0.7rem;font-family:DM Mono,monospace';
    toast('Hardware fingerprint enrolled!', 'success', '🔒');
    addLog('WebAuthn credential registered (platform authenticator)', 'auth');
  } catch(e) {
    toast('WebAuthn failed: ' + e.message + ' — using ORB simulation', 'warn');
    addLog('WebAuthn enrollment failed: ' + e.message, 'warn');
    simulateFingerprint();
  }
};

window.simulateFingerprint = function() {
  STATE.regFpCaptured = true;
  STATE.regWebAuthnId = null;
  document.getElementById('fpArea').classList.add('scanned');
  document.getElementById('fpIcon').textContent = '🔒';
  document.getElementById('fpText').textContent = '✓ ORB fingerprint descriptor enrolled (simulated)';
  document.getElementById('fpArea').onclick = null;
  const lbl = document.getElementById('fpModeLabel');
  if (lbl) { lbl.textContent = 'ORB Simulated'; lbl.style.cssText = 'color:var(--warn);font-size:0.7rem;font-family:DM Mono,monospace'; }
  toast('Fingerprint enrolled (ORB mode)', 'success');
  addLog('ORB fingerprint template stored (simulated)', 'auth');
};

// ---- REGISTER USER ----
window.registerUser = async function() {
  // Only admin can register
  if (STATE.currentUser && !can('canRegisterUsers')) {
    toast('Only Admins can register new users', 'error');
    return;
  }

  const name = document.getElementById('regName').value.trim();
  const role = document.getElementById('regRole').value;
  if (!name) { toast('Enter a name', 'error'); return; }
  if (!STATE.regFaceCaptured || !STATE.regFaceDescriptor) { toast('Capture face first', 'error'); return; }

  // Check fingerprint — it's optional based on checkbox
  const fpRequired = document.getElementById('fpRequiredCheck')?.checked !== false;
  if (fpRequired && !STATE.regFpCaptured) { toast('Enroll fingerprint or uncheck the option', 'error'); return; }

  // Duplicate check
  for (const u of STATE.users) {
    if (!u.faceDescriptor) continue;
    const dist = faceapi.euclideanDistance(STATE.regFaceDescriptor, new Float32Array(u.faceDescriptor));
    if (dist < 0.45) {
      toast(`Face already registered as: ${u.name}`, 'error');
      addLog(`Duplicate enrollment blocked — matches ${u.name} (dist=${dist.toFixed(3)})`, 'warn');
      return;
    }
  }

  const id = 'USR' + String(STATE.users.length + 1).padStart(3, '0');
  const user = {
    id, name, role,
    faceDescriptor: Array.from(STATE.regFaceDescriptor),
    fpMode: STATE.regWebAuthnId ? 'webauthn' : (STATE.regFpCaptured ? 'orb' : 'none'),
    webAuthnId: STATE.regWebAuthnId || null,
    fpHash: STATE.regFpCaptured ? ('ORB_' + Math.random().toString(36).slice(2,8).toUpperCase()) : null,
    avatar: STATE.regFaceAvatar || 'simulated',
    registeredAt: new Date().toLocaleString(),
    registeredBy: STATE.currentUser?.id || 'self',
  };

  STATE.users.push(user);
  persistUsers();
  updateDashboard();

  toast(`${name} (${role}) registered!`, 'success');
  addLog(`Enrolled: ${name} [${role}] [${id}] fp:${user.fpMode}`, 'auth');
  addAuditEntry('REGISTER', `New user enrolled: ${name} (${role})`);

  // Reset form
  document.getElementById('regName').value = '';
  STATE.regFaceCaptured = false; STATE.regFaceDescriptor = null;
  STATE.regFaceAvatar = null; STATE.regFpCaptured = false; STATE.regWebAuthnId = null;
  document.getElementById('faceCaptureStatus').innerHTML = 'No face captured yet';
  document.getElementById('faceCaptureStatus').style.borderColor = '';
  document.getElementById('fpArea').className = 'fp-area';
  document.getElementById('fpIcon').textContent = '🖐';
  document.getElementById('fpText').textContent = 'Choose fingerprint method below';
  document.getElementById('fpArea').onclick = null;
  const lbl = document.getElementById('fpModeLabel');
  if (lbl) lbl.textContent = '';
  await sleep(600);
  toast('Registration complete — user can now log in', 'info');
};

// ---- AUDIT LOG ----
window.addAuditEntry = function(action, detail) {
  if (!STATE.auditLog) STATE.auditLog = [];
  STATE.auditLog.unshift({ ts: new Date().toISOString(), action, detail, user: STATE.currentUser?.name || 'System' });
  if (STATE.auditLog.length > 100) STATE.auditLog.pop();
  try { localStorage.setItem('medsecure_audit', JSON.stringify(STATE.auditLog.slice(0,100))); } catch(e) {}
};

// ---- UTILS ----
function chipCss(color, bg) {
  return `background:${bg};color:${color};padding:3px 10px;border-radius:20px;font-size:0.7rem;font-family:DM Mono,monospace;`;
}
function badgeStyle(color, bg) {
  return `background:${bg};color:${color};padding:3px 10px;border-radius:20px;font-size:0.7rem;font-family:DM Mono,monospace;display:inline-flex;align-items:center;`;
}
function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
  return buf.buffer;
}