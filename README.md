# MedSecure v2 — Biometric Cloud System
### Group 13 — Cloud Computing Project

## Project Structure

```
MedSecure/
├── index.html                  # Main entry point (open in browser)
├── README.md
├── css/
│   └── style.css               # All styles
├── js/
│   ├── permissions.js          # RBAC — role definitions + permission checks
│   ├── ui.js                   # Toast, log, dashboard, render helpers
│   ├── storage.js              # RPF fragmentation + AWS S3 / localStorage
│   ├── faceAuth.js             # Real face recognition + WebAuthn fingerprint
│   └── app.js                  # Global state, navigation, init
├── data/                       # face-api.js model weights (loaded from CDN)
└── assets/                     # Static assets
```

---

## New Features (v2)

### 1. Real Hardware Fingerprint (WebAuthn)
Your laptop fingerprint sensor works via the **WebAuthn W3C standard**:
- Click **"Hardware Sensor"** during registration
- Your OS prompts for fingerprint / Windows Hello / Touch ID
- A **cryptographic credential** is stored in the secure enclave (not the image)
- During login, the sensor verifies automatically

**Note**: Browser cannot access fingerprint image pixels — WebAuthn gives a
cryptographic proof instead. This is actually more secure than ORB matching.

- If no sensor / sensor fails → falls back to **ORB simulation** automatically

### 2. Role-Based Access Control (RBAC)

| Role       | Register | Upload | View Files | Delete | AWS Config |
|------------|----------|--------|------------|--------|------------|
| Admin      | ✓        | ✓      | All        | Any    | ✓          |
| Doctor     | ✗        | ✓      | All        | Own    | ✗          |
| Nurse      | ✗        | ✓      | All        | ✗      | ✗          |
| Technician | ✗        | ✓      | All        | ✗      | ✗          |
| Patient    | ✗        | ✗      | Shared only| ✗      | ✗          |

- Doctors/Admins can **share files** with specific patients
- Admin can **delete any user** from Users page
- UI adapts after login (upload zone hidden for patients, etc.)

### 3. AWS S3 Integration (Real Cloud)
Files → Storage → Configure AWS S3:
1. Create S3 bucket
2. Add CORS policy (see in-app instructions)
3. Create IAM user with S3 permissions
4. Enter region + bucket + credentials in app
5. All future uploads go to S3 (8 fragments × 3 store prefixes)

**S3 key structure:**
```
medsecure/StoreA/{fileId}/0
medsecure/StoreB/{fileId}/1
medsecure/StoreC/{fileId}/2
...
```

Uses **AWS Signature v4** generated in-browser — no backend server needed.

### 4. Audit Trail
All events (login, register, upload, delete, share) are logged with timestamp
and username. Persists in localStorage. Viewable in the Audit tab.

---

## localStorage Keys

| Key | Contents |
|-----|----------|
| `medsecure_users` | User profiles + Float32Array face descriptors |
| `medsecure_files` | File metadata (no binary) |
| `medsecure_sessions` | Auth session count |
| `medsecure_audit` | Audit event log |
| `medsecure_aws_config` | AWS credentials |
| `StoreA_{fileId}_{i}` | Base64 fragment (local mode) |
| `StoreB_{fileId}_{i}` | Base64 fragment (local mode) |
| `StoreC_{fileId}_{i}` | Base64 fragment (local mode) |

---

## How to Run
1. Open `index.html` in Chrome/Firefox/Edge
2. Wait ~10s for face recognition models to load from CDN
3. Register a user (Admin first, then others)
4. Log in with face recognition
5. Upload and retrieve files

## Recommendation: localStorage vs AWS S3

| | localStorage | AWS S3 |
|--|--|--|
| Setup | Zero | ~10 min |
| Limit | ~5-10 MB total | Unlimited |
| Real cloud | ✗ | ✓ |
| Survives browser clear | ✗ | ✓ |
| For demo | ✓ Perfect | ✓ Better for marks |

**Use localStorage for quick demo. Use AWS S3 for the actual submission.**