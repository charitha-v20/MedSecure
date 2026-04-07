// ============================================================
// faceAuth.js — Real face recognition using face-api.js
// Models: SSD MobileNet (detection) + 68-point Landmarks + FaceNet (recognition)
// Descriptors stored as Float32Array in localStorage via storage.js
// ============================================================

const FACE_MATCH_THRESHOLD = 0.55; // Euclidean distance (lower = stricter)
const FP_WEIGHT = 0.35;            // Weight for fingerprint in fusion
const FACE_WEIGHT = 0.65;          // Weight for face in fusion

let loginStream = null;
let loginDetectionInterval = null;
let regStream = null;
let regDetectionInterval = null;
let modelsLoaded = false;

// ---- MODEL LOADING ----
window.loadFaceModels = async function() {
  const overlay = document.getElementById('modelOverlay');
  const fill = document.getElementById('modelProgressFill');
  const sub = document.getElementById('modelSub');

  overlay.style.display = 'flex';

  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

  const steps = [
    { name: 'SSD MobileNet (face detector)', fn: () => faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL) },
    { name: '68-point Landmark Model',        fn: () => faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL) },
    { name: 'FaceNet Recognition Model',      fn: () => faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL) },
  ];

  for (let i = 0; i < steps.length; i++) {
    sub.textContent = `Loading ${steps[i].name}...`;
    fill.style.width = ((i / steps.length) * 100) + '%';
    try {
      await steps[i].fn();
    } catch(e) {
      sub.textContent = `Failed to load ${steps[i].name}: ${e.message}`;
      console.error(e);
      await sleep(2000);
    }
    fill.style.width = (((i + 1) / steps.length) * 100) + '%';
  }

  modelsLoaded = true;
  sub.textContent = 'Models ready!';
  fill.style.width = '100%';
  await sleep(600);
  overlay.style.display = 'none';
  addLog('face-api.js models loaded (SSD MobileNet + FaceNet)', 'auth');
  toast('Face recognition models loaded', 'success', '🧠');
};

// ---- CAMERA HELPERS ----
async function openCamera(videoEl, canvasEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
  });
  videoEl.srcObject = stream;
  await new Promise(res => { videoEl.onloadedmetadata = res; });
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  return stream;
}

function closeStream(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

// ---- LOGIN CAMERA ----
window.startLoginCamera = async function() {
  if (!modelsLoaded) { toast('Models still loading, please wait...', 'warn'); return; }
  const vid = document.getElementById('loginVideo');
  const cvs = document.getElementById('loginCanvas');

  try {
    loginStream = await openCamera(vid, cvs);
    STATE.loginStream = loginStream;
    document.getElementById('loginCamStatus').innerHTML = '● Active';
    document.getElementById('loginCamStatus').style.cssText = chipStyle('var(--accent3)', 'rgba(0,255,157,0.1)');
    document.getElementById('btnStartLogin').style.display = 'none';
    document.getElementById('btnStopLogin').style.display = '';
    document.getElementById('btnCapture').disabled = false;
    document.getElementById('loginScanLine').classList.add('active');
    document.getElementById('loginFaceStatus').textContent = 'Camera active — align face in frame';
    setStep(1, 'done');
    setStep(2, 'active');
    addLog('Login camera started', 'auth');
    startLoginDetection(vid, cvs);
  } catch(e) {
    toast('Camera error: ' + e.message, 'error');
    addLog('Camera access failed: ' + e.message, 'error');
  }
};

window.stopLoginCamera = function() {
  closeStream(loginStream);
  loginStream = null;
  STATE.loginStream = null;
  if (loginDetectionInterval) { clearInterval(loginDetectionInterval); loginDetectionInterval = null; }
  const cvs = document.getElementById('loginCanvas');
  const ctx = cvs.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, cvs.width, cvs.height);
  document.getElementById('loginVideo').srcObject = null;
  document.getElementById('btnStartLogin').style.display = '';
  document.getElementById('btnStopLogin').style.display = 'none';
  document.getElementById('btnCapture').disabled = true;
  document.getElementById('loginScanLine').classList.remove('active');
  document.getElementById('loginCamStatus').innerHTML = '● Inactive';
  document.getElementById('loginCamStatus').style.cssText = chipStyle('var(--warn)', 'rgba(255,165,2,0.1)');
  document.getElementById('loginFaceStatus').textContent = 'Camera stopped';
};

function startLoginDetection(vid, cvs) {
  const ctx = cvs.getContext('2d');
  loginDetectionInterval = setInterval(async () => {
    if (!vid.videoWidth || vid.paused) return;
    ctx.drawImage(vid, 0, 0, cvs.width, cvs.height);

    if (!modelsLoaded) return;
    try {
      const detection = await faceapi
        .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks();

      if (detection) {
        const { box } = detection.detection;
        // Draw box
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        // Corner accents
        drawCorners(ctx, box, '#00ff9d', 20);

        // Landmark dots
        ctx.fillStyle = '#00d4ff';
        detection.landmarks.positions.forEach(pt => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        });

        // Label
        const conf = (detection.detection.score * 100).toFixed(1);
        ctx.fillStyle = '#00d4ff';
        ctx.fillRect(box.x, box.y - 22, 140, 20);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 11px DM Mono, monospace';
        ctx.fillText(`FACE DETECTED ${conf}%`, box.x + 4, box.y - 7);

        document.getElementById('loginFaceStatus').textContent = `Face detected — confidence: ${conf}%`;
        document.getElementById('conf2').style.width = conf + '%';
        setStep(2, 'done');
        STATE.loginFaceDetected = true;
      } else {
        document.getElementById('loginFaceStatus').textContent = 'No face detected — center your face';
        STATE.loginFaceDetected = false;
        setStep(2, 'active');
      }
    } catch(e) {
      // Detection error — skip frame
    }
  }, 200);
}

// ---- CAPTURE & AUTHENTICATE ----
window.captureAndAuth = async function() {
  if (STATE.users.length === 0) {
    toast('No users enrolled. Please register first.', 'error');
    return;
  }
  if (!modelsLoaded) { toast('Models not loaded yet', 'warn'); return; }

  const vid = document.getElementById('loginVideo');
  document.getElementById('btnCapture').disabled = true;
  addLog('Authentication initiated', 'auth');

  // Step 2 - Detect face
  setStep(2, 'active');
  document.getElementById('loginFaceStatus').textContent = 'Detecting face...';

  const detection = await faceapi
    .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    toast('No face detected! Please center your face.', 'error');
    addLog('Auth failed — no face detected', 'error');
    document.getElementById('btnCapture').disabled = false;
    document.getElementById('loginFaceStatus').textContent = 'No face — try again';
    return;
  }

  setStep(2, 'done');
  document.getElementById('conf2').style.width = (detection.detection.score * 100).toFixed(0) + '%';
  await sleep(300);

  // Step 3 - Extract FaceNet descriptor
  setStep(3, 'active');
  document.getElementById('loginFaceStatus').textContent = 'Extracting 128-d face embedding...';
  await sleep(400);
  const capturedDescriptor = detection.descriptor; // Float32Array(128)
  setStep(3, 'done');
  document.getElementById('conf3').style.width = '90%';
  await sleep(300);

  // Step 4 - Fingerprint (simulated ORB score)
  setStep(4, 'active');
  document.getElementById('loginFaceStatus').textContent = 'ORB fingerprint matching...';
  await sleep(500);
  const fpScore = 0.80 + Math.random() * 0.18; // Simulated: real system reads hardware
  setStep(4, 'done');
  document.getElementById('conf4').style.width = (fpScore * 100).toFixed(0) + '%';
  await sleep(300);

  // Step 5 - Score-level fusion: match against all enrolled users
  setStep(5, 'active');
  document.getElementById('loginFaceStatus').textContent = 'Computing score-level fusion...';
  await sleep(400);

  let bestMatch = null;
  let bestFaceScore = 0;

  STATE.users.forEach(user => {
    if (!user.faceDescriptor) return;
    const storedDesc = new Float32Array(user.faceDescriptor);
    // Euclidean distance (face-api standard): lower = more similar
    const distance = faceapi.euclideanDistance(capturedDescriptor, storedDesc);
    // Convert to similarity score: 0 distance = 1.0 similarity
    const faceScore = Math.max(0, 1 - distance / 1.0);
    if (faceScore > bestFaceScore) {
      bestFaceScore = faceScore;
      bestMatch = { user, faceScore, distance };
    }
  });

  const fusedScore = bestMatch
    ? FACE_WEIGHT * bestMatch.faceScore + FP_WEIGHT * fpScore
    : 0;

  setStep(5, 'done');
  document.getElementById('conf5').style.width = (fusedScore * 100).toFixed(0) + '%';
  await sleep(300);

  // Step 6 - Decision (distance < threshold = match)
  const DISTANCE_THRESHOLD = FACE_MATCH_THRESHOLD;
  const matched = bestMatch && bestMatch.distance < DISTANCE_THRESHOLD;

  if (matched) {
    setStep(6, 'done');
    STATE.currentUser = bestMatch.user;
    STATE.sessions++;
    persistSessions();

    const pct = (fusedScore * 100).toFixed(1);
    const dist = bestMatch.distance.toFixed(3);

    document.getElementById('authUserLabel').textContent =
      `✓ ${bestMatch.user.name} (${bestMatch.user.role}) — dist: ${dist}`;
    document.getElementById('authResultBadge').innerHTML = '✓ Authenticated';
    document.getElementById('authResultBadge').style.cssText =
      `background:rgba(0,255,157,0.15);color:var(--accent3);${chipBase}`;
    document.getElementById('authMessage').innerHTML =
      `<div class="match-card success">
        <strong style="color:var(--accent3)">✓ Identity confirmed</strong><br>
        <span style="font-size:0.78rem;color:var(--text2)">
          User: ${bestMatch.user.name} &nbsp;|&nbsp; 
          Role: ${bestMatch.user.role} &nbsp;|&nbsp; 
          Distance: ${dist} &nbsp;|&nbsp; 
          Fused score: ${pct}%
        </span>
      </div>`;
    document.getElementById('btnAccessFiles').style.display = '';
    document.getElementById('loginFaceStatus').textContent = `✓ Welcome, ${bestMatch.user.name}`;
    toast(`Welcome, ${bestMatch.user.name}!`, 'success');
    addLog(`Authenticated: ${bestMatch.user.name} | dist=${dist} | fused=${pct}%`, 'auth');
    updateDashboard();
  } else {
    const dist = bestMatch ? bestMatch.distance.toFixed(3) : 'N/A';
    document.getElementById('authResultBadge').innerHTML = '✗ Failed';
    document.getElementById('authResultBadge').style.cssText =
      `background:rgba(255,71,87,0.15);color:var(--danger);${chipBase}`;
    document.getElementById('authMessage').innerHTML =
      `<div class="match-card fail">
        <strong style="color:var(--danger)">✗ Authentication failed</strong><br>
        <span style="font-size:0.78rem;color:var(--text2)">
          Best distance: ${dist} (threshold: ${DISTANCE_THRESHOLD}) — no match
        </span>
      </div>`;
    document.getElementById('loginFaceStatus').textContent = 'Authentication failed';
    toast('No matching face found', 'error');
    addLog(`Auth failed — best dist=${dist}, threshold=${DISTANCE_THRESHOLD}`, 'error');
    document.getElementById('btnCapture').disabled = false;
  }
};

window.resetAuth = function() {
  [1,2,3,4,5,6].forEach(i => setStep(i, ''));
  ['conf2','conf3','conf4','conf5'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.width = '0%';
  });
  document.getElementById('authResultBadge').innerHTML = 'Pending';
  document.getElementById('authResultBadge').style.cssText = `background:rgba(42,48,69,0.5);color:var(--text3);${chipBase}`;
  document.getElementById('authMessage').innerHTML = '';
  document.getElementById('authUserLabel').textContent = 'Awaiting authentication';
  document.getElementById('btnAccessFiles').style.display = 'none';
  document.getElementById('loginFaceStatus').textContent = 'Ready — click Capture & Verify';
  document.getElementById('btnCapture').disabled = !loginStream;
  STATE.currentUser = null;
};

// ---- REGISTRATION CAMERA ----
window.startRegCamera = async function() {
  if (!modelsLoaded) { toast('Models still loading...', 'warn'); return; }
  const vid = document.getElementById('regVideo');
  const cvs = document.getElementById('regCanvas');

  try {
    regStream = await openCamera(vid, cvs);
    STATE.regStream = regStream;
    document.getElementById('regCamStatus').innerHTML = '● Active';
    document.getElementById('regCamStatus').style.cssText = chipStyle('var(--accent3)', 'rgba(0,255,157,0.1)');
    document.getElementById('btnRegStartCam').style.display = 'none';
    document.getElementById('btnRegStop').style.display = '';
    document.getElementById('btnRegCapture').disabled = false;
    document.getElementById('regScanLine').classList.add('active');
    document.getElementById('regFaceStatus').textContent = 'Camera active — center your face';
    startRegDetection(vid, cvs);
  } catch(e) {
    toast('Camera error: ' + e.message, 'error');
  }
};

window.stopRegCamera = function() {
  closeStream(regStream);
  regStream = null;
  STATE.regStream = null;
  if (regDetectionInterval) { clearInterval(regDetectionInterval); regDetectionInterval = null; }
  const cvs = document.getElementById('regCanvas');
  const ctx = cvs.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, cvs.width, cvs.height);
  document.getElementById('regVideo').srcObject = null;
  document.getElementById('btnRegStartCam').style.display = '';
  document.getElementById('btnRegStop').style.display = 'none';
  document.getElementById('btnRegCapture').disabled = true;
  document.getElementById('regScanLine').classList.remove('active');
  document.getElementById('regCamStatus').innerHTML = '● Inactive';
  document.getElementById('regCamStatus').style.cssText = chipStyle('var(--warn)', 'rgba(255,165,2,0.1)');
};

function startRegDetection(vid, cvs) {
  const ctx = cvs.getContext('2d');
  regDetectionInterval = setInterval(async () => {
    if (!vid.videoWidth || vid.paused) return;
    ctx.drawImage(vid, 0, 0, cvs.width, cvs.height);
    try {
      const det = await faceapi
        .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks();

      if (det) {
        const { box } = det.detection;
        ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        drawCorners(ctx, box, '#00ff9d', 18);
        ctx.fillStyle = '#00d4ff';
        det.landmarks.positions.forEach(pt => {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2); ctx.fill();
        });
        ctx.fillStyle = '#00d4ff';
        ctx.fillRect(box.x, box.y - 22, 150, 20);
        ctx.fillStyle = '#000'; ctx.font = 'bold 11px DM Mono, monospace';
        ctx.fillText('FACE DETECTED — CAPTURE ✓', box.x + 4, box.y - 7);
        document.getElementById('regFaceStatus').textContent = 'Face detected — press Capture!';
        STATE.regFaceInFrame = true;
      } else {
        document.getElementById('regFaceStatus').textContent = 'No face — center yourself';
        STATE.regFaceInFrame = false;
      }
    } catch(e) {}
  }, 250);
}

// ---- CAPTURE FACE FOR REGISTRATION ----
window.captureRegFace = async function() {
  if (!modelsLoaded) { toast('Models not loaded', 'warn'); return; }
  const vid = document.getElementById('regVideo');

  document.getElementById('btnRegCapture').disabled = true;
  document.getElementById('regFaceStatus').textContent = 'Extracting face descriptor...';

  try {
    const detection = await faceapi
      .detectSingleFace(vid, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      toast('No face detected — please try again', 'error');
      document.getElementById('btnRegCapture').disabled = false;
      document.getElementById('regFaceStatus').textContent = 'No face found — try again';
      return;
    }

    STATE.regFaceDescriptor = detection.descriptor; // Float32Array(128)

    // Capture photo for avatar
    const tempC = document.createElement('canvas');
    tempC.width = vid.videoWidth;
    tempC.height = vid.videoHeight;
    tempC.getContext('2d').drawImage(vid, 0, 0);
    STATE.regFaceAvatar = tempC.toDataURL('image/jpeg', 0.7);

    STATE.regFaceCaptured = true;

    document.getElementById('faceCaptureStatus').innerHTML =
      `<span style="color:var(--accent3)">✓ 128-d FaceNet descriptor captured (distance-based matching)</span>`;
    document.getElementById('faceCaptureStatus').style.borderColor = 'rgba(0,255,157,0.3)';

    toast('Face descriptor captured!', 'success');
    addLog('Face template (128-d) captured for registration', 'auth');
    stopRegCamera();

  } catch(e) {
    toast('Capture error: ' + e.message, 'error');
    document.getElementById('btnRegCapture').disabled = false;
  }
};

// ---- FINGERPRINT SIMULATION ----
window.simulateFingerprint = function() {
  const fp = document.getElementById('fpArea');
  fp.classList.add('scanned');
  document.getElementById('fpIcon').textContent = '🔒';
  document.getElementById('fpText').textContent = '✓ Fingerprint enrolled (ORB keypoint descriptor simulated)';
  fp.style.cursor = 'default';
  fp.onclick = null;
  STATE.regFpCaptured = true;
  toast('Fingerprint enrolled!', 'success');
  addLog('Fingerprint template stored (simulated ORB)', 'auth');
};

// ---- REGISTER USER ----
window.registerUser = async function() {
  const name = document.getElementById('regName').value.trim();
  const role = document.getElementById('regRole').value;

  if (!name) { toast('Please enter a name', 'error'); return; }
  if (!STATE.regFaceCaptured || !STATE.regFaceDescriptor) {
    toast('Please capture your face first', 'error'); return;
  }
  if (!STATE.regFpCaptured) {
    toast('Please simulate fingerprint scan', 'error'); return;
  }

  // Check if descriptor already enrolled (prevent duplicate enrollment)
  for (const user of STATE.users) {
    if (!user.faceDescriptor) continue;
    const dist = faceapi.euclideanDistance(STATE.regFaceDescriptor, new Float32Array(user.faceDescriptor));
    if (dist < 0.45) {
      toast(`Face already registered as: ${user.name}`, 'error');
      addLog(`Duplicate enrollment blocked — matches ${user.name}`, 'warn');
      return;
    }
  }

  const id = 'USR' + String(STATE.users.length + 1).padStart(3, '0');

  const user = {
    id,
    name,
    role,
    faceDescriptor: Array.from(STATE.regFaceDescriptor), // serialize Float32Array
    fpHash: 'ORB_' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    avatar: STATE.regFaceAvatar || 'simulated',
    registeredAt: new Date().toLocaleString(),
  };

  STATE.users.push(user);
  persistUsers();
  updateDashboard();

  toast(`${name} registered!`, 'success');
  addLog(`Enrolled: ${name} (${role}) [${id}] — 128-d descriptor stored`, 'auth');

  // Reset registration form
  document.getElementById('regName').value = '';
  STATE.regFaceCaptured = false;
  STATE.regFaceDescriptor = null;
  STATE.regFaceAvatar = null;
  STATE.regFpCaptured = false;
  document.getElementById('faceCaptureStatus').innerHTML = 'No face captured yet';
  document.getElementById('faceCaptureStatus').style.borderColor = '';
  document.getElementById('fpArea').className = 'fp-area';
  document.getElementById('fpIcon').textContent = '🖐';
  document.getElementById('fpText').textContent = 'Click to simulate fingerprint scan';
  document.getElementById('fpArea').onclick = simulateFingerprint;

  await sleep(600);
  toast('Switch to Login tab to authenticate', 'info');
};

// ---- DRAWING HELPERS ----
function drawCorners(ctx, box, color, len) {
  const { x, y, width: w, height: h } = box;
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  [[x, y+len, x, y, x+len, y], [x+w-len, y, x+w, y, x+w, y+len],
   [x, y+h-len, x, y+h, x+len, y+h], [x+w-len, y+h, x+w, y+h, x+w, y+h-len]]
  .forEach(([x1,y1,x2,y2,x3,y3]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke();
  });
}

function chipStyle(color, bg) {
  return `background:${bg};color:${color};padding:3px 10px;border-radius:20px;font-size:0.7rem;font-family:DM Mono,monospace;`;
}

const chipBase = 'padding:3px 10px;border-radius:20px;font-size:0.7rem;font-family:DM Mono,monospace;';