# Mnemo — The Active Vault

> A pure 2D, high-performance quote sanctuary that merges Kindle and Google Play Books highlights into one deduplicated, searchable library. Installable as a PWA.

---

## Architecture

```
mnemo/
├── mnemo-backend/        # FastAPI + SQLite backend
│   └── main.py
└── apps/mobile-pwa/      # React + Vite PWA frontend
    ├── src/
    │   ├── App.jsx
    │   └── App.css
    └── public/
        ├── manifest.json
        └── sw.js
```

---

## Prerequisites

- **Python 3.11+** with `pip`
- **Node.js 20+** with `npm`
- A **Google Cloud Console** project (for Drive sync)

---

## Backend Setup

```bash
cd mnemo/mnemo-backend

# 1. Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

# 2. Install dependencies
pip install fastapi uvicorn "python-multipart" \
            google-api-python-client google-auth google-auth-oauthlib

# 3. Start the server
uvicorn main:app --reload --port 8000
```

---

## Frontend Setup

```bash
cd mnemo/apps/mobile-pwa

# 1. Install dependencies
npm install

# 2. Create a local environment file
echo "VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE.apps.googleusercontent.com" > .env

# 3. Start the dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Google Cloud Console — Drive Sync Setup

### 1. Create a Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project named **Mnemo**

### 2. Enable the Google Drive API

- APIs & Services → Library → Search "Google Drive API" → Enable

### 3. Configure OAuth Consent Screen

- APIs & Services → OAuth consent screen
- User Type: **External**
- Add your email as a **Test User**
- Scopes: add `https://www.googleapis.com/auth/drive.readonly`
  - This is the **minimum necessary scope** — read-only access to your Drive

### 4. Create OAuth Credentials

- APIs & Services → Credentials → Create Credentials → **OAuth client ID**
- Application type: **Web application**
- Authorized JavaScript origins:
  - `http://localhost:5173`
  - `http://localhost` (for PWA testing)
- Copy the **Client ID** and paste it into your `.env` file

### 5. How it Works

When you click **Sync Drive** in the vault:

1. `@react-oauth/google` opens Google's OAuth popup requesting `drive.readonly`
2. On success, a short-lived `access_token` is sent to `POST /sync/drive`
3. The backend uses `google-api-python-client` to:
   - Find the folder named **"Play Books Notes"** in your Drive
   - Iterate every Google Doc inside it
   - Export each as `text/plain`
   - Parse `Highlight` / `Note` blocks
4. Each fragment is fingerprinted and inserted — **duplicates are silently skipped**

---

## SHA-256 Fingerprinting — Deduplication System

Every highlight is assigned a deterministic primary key before being stored:

```python
def normalize_title(raw_title: str) -> str:
    clean = raw_title.upper().strip()
    clean = re.split(r'\s+-\s+|\s+BY\s+', clean)[0]   # strip author
    clean = re.sub(r'\([^)]*\)', '', clean)             # strip parentheticals
    return clean.strip()

def generate_fingerprint(normalized_title: str, content: str) -> str:
    raw = f"{normalized_title}::{content.strip()}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()
```

**Example:**
| Raw Input | Normalized | Result |
|---|---|---|
| `"Dune (Frank Herbert)"` | `DUNE` | same fingerprint |
| `"Dune - Frank Herbert"` | `DUNE` | same fingerprint |
| `"Dune"` (Kindle) | `DUNE` | same fingerprint |

The same quote highlighted in both Kindle and Google Play Books will produce **identical fingerprints** and be stored **exactly once**. `INSERT OR IGNORE` via `sqlite3.IntegrityError` handles the deduplication transparently.

---

## Stacks (Grouping Logic)

On the library home screen, all highlights sharing the same `book_title` (i.e., the same `normalized_title`) are collapsed into a single **Stack** card. Clicking a Stack drills into that volume.

> **Critical:** The frontend groups exclusively by `book_title` as returned by the API. The backend guarantees this is always the normalized form.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/highlights/` | Fetch all highlights |
| `POST` | `/highlights/` | Create a manual highlight |
| `PUT` | `/highlights/{id}` | Edit highlight content |
| `DELETE` | `/highlights/{id}` | Delete a highlight |
| `PUT` | `/sources/rename` | Bulk-rename a volume |
| `POST` | `/sync/drive` | Sync Google Play Books from Drive |

---

## PWA Installation

1. Open the app in Chrome on Android (or Safari on iOS)
2. Tap **"Add to Home Screen"** when prompted
3. The app launches in `standalone` mode (no browser chrome)
4. The Service Worker (`sw.js`) is present to satisfy installation requirements

---

## Data Sources Supported

| Source | How to Sync |
|--------|-------------|
| **Kindle** | Click "Kindle" upload button in the header and select your `My Clippings.txt` |
| **Google Play Books** | Click "Sync Drive" button — requires Drive OAuth |
| **Manual** | Click "+ Add" anywhere in the vault |

---

## Security Notes

- `mnemo_vault.db` is excluded from version control — your highlights are private
- The `access_token` passed to `/sync/drive` is never stored on the server
- CORS is set to `*` for local dev; restrict `allow_origins` before deploying publicly
