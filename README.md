# MedSecure — Biometric Cloud System
### Group 13 — Cloud Computing Project

## Project Structure

```
MedSecure/
├── index.html              # Main entry point
├── README.md               # This file
├── css/
│   └── style.css           # All styles
├── js/
│   ├── app.js              # App init, navigation, state
│   ├── faceAuth.js         # Real face recognition (face-api.js)
│   ├── storage.js          # RPF fragmentation + localStorage persistence
│   └── ui.js               # Toast, log, dashboard, render helpers
├── data/
│   └── .gitkeep            # face-api.js model weights go here (auto-downloaded)
└── assets/
    └── .gitkeep            # Static assets
```

## How Face Recognition Works

Uses **face-api.js** (TensorFlow.js) for real in-browser face recognition:
1. **SSD MobileNet** — detects face bounding box
2. **68-point Landmark Model** — maps facial landmarks
3. **FaceNet (128-d descriptor)** — generates face embedding vector
4. **Euclidean distance** comparison against stored descriptors

Face descriptors are stored in `localStorage` under key `medsecure_users`.

## How File Storage Works (RPF)

Random Pattern Fragmentation splits files into 8 chunks, shuffles them,
then stores each chunk in a different "store" in localStorage:
- `StoreA_*` — fragments 0, 3, 6
- `StoreB_*` — fragments 1, 4, 7
- `StoreC_*` — fragments 2, 5

Reassembly requires knowing the pattern (also stored in metadata).

## localStorage Keys

| Key | Contents |
|-----|----------|
| `medsecure_users` | JSON array of user profiles + face descriptors |
| `medsecure_files` | JSON array of file metadata (no actual binary data) |
| `medsecure_sessions` | Auth session count |
| `StoreA_{fileId}_{fragIdx}` | Base64-encoded fragment data |
| `StoreB_{fileId}_{fragIdx}` | Base64-encoded fragment data |
| `StoreC_{fileId}_{fragIdx}` | Base64-encoded fragment data |

## Running

Just open `index.html` in a browser. No server needed.
face-api.js models are loaded from CDN automatically.