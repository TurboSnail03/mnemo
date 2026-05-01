import sqlite3
import hashlib
import os
import re
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# --- 1. THE DATABASE SETUP ---
DB_FILE = "mnemo_vault.db"

def get_conn():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    cursor = conn.cursor()
    # Main highlights table — id is the SHA-256 fingerprint (deduplication key)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS highlights (
            id       TEXT PRIMARY KEY,
            book_title TEXT NOT NULL,
            author   TEXT DEFAULT 'Unknown',
            content  TEXT NOT NULL,
            added_on TEXT,
            source   TEXT DEFAULT 'manual'
        )
    ''')
    # Safe migration: add `source` column to databases created before this version
    try:
        cursor.execute("ALTER TABLE highlights ADD COLUMN source TEXT DEFAULT 'manual'")
        print("[Mnemo] Migrated: added 'source' column to highlights table.")
    except Exception:
        pass  # Column already exists — no action needed
    conn.commit()
    conn.close()

# --- 2. THE SYNCHRONIZATION ENGINE ---

def normalize_title(raw_title: str) -> str:
    """
    Cleans titles to ensure cross-platform merging (Play Books vs Kindle).
    Examples:
      "Dune (Frank Herbert)"        → "DUNE"
      "Dune - Frank Herbert"        → "DUNE"
      "Atomic Habits BY James Clear" → "ATOMIC HABITS"
    """
    if not raw_title:
        return "Stray Thoughts"

    clean = raw_title.upper().strip()
    # Split on " - " separator or " BY " keyword
    clean = re.split(r'\s+-\s+|\s+BY\s+', clean)[0]
    # Strip any trailing parenthetical, e.g. "(FRANK HERBERT)"
    clean = re.sub(r'\([^)]*\)', '', clean)
    return clean.strip()


def generate_fingerprint(normalized_title: str, content: str) -> str:
    """
    SHA-256 hash of (normalized_title + content).
    This is the primary key — guarantees that the same quote from Kindle
    and Google Play Books is stored only once.
    """
    raw_string = f"{normalized_title}::{content.strip()}"
    return hashlib.sha256(raw_string.encode('utf-8')).hexdigest()


# --- 3. THE INGESTORS (Kindle & Play Books local files) ---

def ingest_clippings(filepath="My Clippings.txt"):
    """Parses Kindle USB-export clippings file."""
    if not os.path.exists(filepath):
        return 0

    conn = get_conn()
    cursor = conn.cursor()

    with open(filepath, 'r', encoding='utf-8-sig') as f:
        raw_text = f.read()

    blocks = raw_text.split('==========')
    added_count = 0

    for block in blocks:
        lines = [line.strip() for line in block.strip().split('\n') if line.strip()]

        if len(lines) >= 3:
            title_line = lines[0]
            meta_line  = lines[1]
            content    = " ".join(lines[2:])

            if "Highlight" not in meta_line:
                continue

            raw_title = title_line
            author    = "Unknown"
            if "(" in title_line and title_line.endswith(")"):
                parts     = title_line.rsplit("(", 1)
                raw_title = parts[0].strip()
                author    = parts[1].replace(")", "").strip()

            clean_title = normalize_title(raw_title)
            fingerprint = generate_fingerprint(clean_title, content)

            try:
                cursor.execute(
                    "INSERT INTO highlights (id, book_title, author, content, added_on, source)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (fingerprint, clean_title, author, content, meta_line, "kindle")
                )
                added_count += 1
            except sqlite3.IntegrityError:
                pass  # Duplicate — silently skip

    conn.commit()
    conn.close()

    if added_count > 0:
        print(f"[Mnemo] Forged {added_count} Kindle thoughts into the vault.")
    return added_count


def ingest_playbooks(filepath="PlayBooks.txt"):
    """Parses exported Google Docs (.txt) from Google Play Books sync."""
    if not os.path.exists(filepath):
        return 0

    conn = get_conn()
    cursor = conn.cursor()

    with open(filepath, 'r', encoding='utf-8-sig') as f:
        lines = f.readlines()

    if len(lines) < 2:
        return 0

    raw_title   = lines[0].strip()
    author      = lines[1].strip()
    clean_title = normalize_title(raw_title)

    added_count   = 0
    current_quote = []
    meta_data     = "Play Books Export"

    for line in lines[2:]:
        line = line.strip()
        if not line:
            continue

        if line.startswith("Highlight") or line.startswith("Note"):
            if current_quote:
                content     = " ".join(current_quote)
                fingerprint = generate_fingerprint(clean_title, content)
                try:
                    cursor.execute(
                        "INSERT INTO highlights (id, book_title, author, content, added_on, source)"
                        " VALUES (?, ?, ?, ?, ?, ?)",
                        (fingerprint, clean_title, author, content, meta_data, "playbooks")
                    )
                    added_count += 1
                except sqlite3.IntegrityError:
                    pass
                current_quote = []
            meta_data = line
        else:
            current_quote.append(line)

    # Catch the final quote in the file
    if current_quote:
        content     = " ".join(current_quote)
        fingerprint = generate_fingerprint(clean_title, content)
        try:
            cursor.execute(
                "INSERT INTO highlights (id, book_title, author, content, added_on, source)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (fingerprint, clean_title, author, content, meta_data, "playbooks")
            )
            added_count += 1
        except sqlite3.IntegrityError:
            pass

    conn.commit()
    conn.close()

    if added_count > 0:
        print(f"[Mnemo] Synced {added_count} Play Books thoughts into the vault.")
    return added_count


def parse_playbooks_doc_text(raw_text: str, raw_title: str, author: str) -> list[dict]:
    """
    Parses the plain-text export of a Google Play Books Doc.
    Returns a list of dicts: {book_title, author, content, meta}
    """
    clean_title   = normalize_title(raw_title)
    results       = []
    current_quote = []
    meta_data     = "Play Books Drive Sync"

    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue

        if line.startswith("Highlight") or line.startswith("Note"):
            if current_quote:
                content = " ".join(current_quote)
                results.append({
                    "book_title": clean_title,
                    "author":     author,
                    "content":    content,
                    "meta":       meta_data,
                })
                current_quote = []
            meta_data = line
        else:
            current_quote.append(line)

    if current_quote:
        content = " ".join(current_quote)
        results.append({
            "book_title": clean_title,
            "author":     author,
            "content":    content,
            "meta":       meta_data,
        })

    return results


# --- 4. THE API SERVER & MODELS ---
app = FastAPI(title="Mnemo API — Active Vault")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Highlight(BaseModel):
    id:         str
    book_title: str
    author:     str
    content:    str
    url:        Optional[str] = None
    source:     Optional[str] = None


class HighlightCreate(BaseModel):
    book_title: Optional[str] = "Stray Thoughts"
    content:    str


class HighlightUpdate(BaseModel):
    content: str


class SourceRename(BaseModel):
    old_title: str
    new_title: str


class DriveSyncRequest(BaseModel):
    access_token: str


@app.on_event("startup")
def startup_event():
    init_db()
    ingest_clippings()
    ingest_playbooks()


# --- 5. THE ACTIVE VAULT ENDPOINTS ---

@app.get("/highlights/", response_model=List[Highlight])
def get_highlights():
    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT id, book_title, author, content, source FROM highlights ORDER BY rowid DESC")
    rows = cursor.fetchall()
    conn.close()
    return [
        {"id": r["id"], "book_title": r["book_title"], "author": r["author"],
         "content": r["content"], "source": r["source"]}
        for r in rows
    ]


@app.post("/highlights/", response_model=Highlight)
def create_highlight(data: HighlightCreate):
    conn        = get_conn()
    cursor      = conn.cursor()
    clean_title = normalize_title(data.book_title)
    fingerprint = generate_fingerprint(clean_title, data.content)
    timestamp   = f"Manual Entry - {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    try:
        cursor.execute(
            "INSERT INTO highlights (id, book_title, author, content, added_on, source)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (fingerprint, clean_title, "Unknown", data.content, timestamp, "manual")
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass  # Already exists — idempotent
    finally:
        conn.close()

    return {"id": fingerprint, "book_title": clean_title, "author": "Unknown",
            "content": data.content, "source": "manual"}


@app.put("/highlights/{highlight_id}")
def update_highlight(highlight_id: str, data: HighlightUpdate):
    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("UPDATE highlights SET content = ? WHERE id = ?", (data.content, highlight_id))
    updated = cursor.rowcount
    conn.commit()
    conn.close()

    if updated == 0:
        raise HTTPException(status_code=404, detail="Thought not found")
    return {"status": "Thought updated"}


@app.put("/sources/rename")
def rename_source(data: SourceRename):
    conn          = get_conn()
    cursor        = conn.cursor()
    clean_new     = normalize_title(data.new_title)
    cursor.execute(
        "UPDATE highlights SET book_title = ? WHERE book_title = ?",
        (clean_new, data.old_title)
    )
    updated = cursor.rowcount
    conn.commit()
    conn.close()
    return {"status": f"Renamed {updated} fragments to {clean_new}", "new_title": clean_new}


@app.delete("/highlights/{highlight_id}")
def burn_highlight(highlight_id: str):
    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()

    if deleted == 0:
        raise HTTPException(status_code=404, detail="Thought not found")
    return {"status": "Burned to ash"}


# --- 6. KINDLE CLIPPINGS FILE UPLOAD ---

@app.post("/upload/clippings")
async def upload_clippings(file: UploadFile = File(...)):
    """
    Accepts a 'My Clippings.txt' file upload from the browser.
    Parses it and inserts highlights into the vault — fully deduplicated.
    This is how users on any device (phone, tablet, deployed app) can
    sync their Kindle highlights without filesystem access.
    """
    if not file.filename or not file.filename.endswith(".txt"):
        raise HTTPException(status_code=400, detail="Please upload a .txt file")

    raw_bytes = await file.read()
    try:
        raw_text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raw_text = raw_bytes.decode("latin-1", errors="replace")

    conn   = get_conn()
    cursor = conn.cursor()
    blocks = raw_text.split("==========")
    added_count = 0

    for block in blocks:
        lines = [line.strip() for line in block.strip().split("\n") if line.strip()]

        if len(lines) >= 3:
            title_line = lines[0]
            meta_line  = lines[1]
            content    = " ".join(lines[2:])

            if "Highlight" not in meta_line:
                continue

            raw_title = title_line
            author    = "Unknown"
            if "(" in title_line and title_line.endswith(")"):
                parts     = title_line.rsplit("(", 1)
                raw_title = parts[0].strip()
                author    = parts[1].replace(")", "").strip()

            clean_title = normalize_title(raw_title)
            fingerprint = generate_fingerprint(clean_title, content)

            try:
                cursor.execute(
                    "INSERT INTO highlights (id, book_title, author, content, added_on, source)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (fingerprint, clean_title, author, content, meta_line, "kindle")
                )
                added_count += 1
            except sqlite3.IntegrityError:
                pass

    conn.commit()
    conn.close()

    print(f"[Mnemo] Upload: forged {added_count} Kindle thoughts into the vault.")
    return {"status": "Upload complete", "added": added_count}


# --- 7. GOOGLE DRIVE SYNC ENGINE ---

@app.post("/sync/drive")
def sync_google_drive(body: DriveSyncRequest):
    """
    Receives a short-lived OAuth access_token from the frontend.
    Finds the 'Play Books Notes' folder in Google Drive, iterates
    all Google Docs inside it, exports each as plain text, and
    parses Highlight / Note blocks — deduplicating via SHA-256
    fingerprint before inserting into SQLite.
    """
    try:
        from googleapiclient.discovery import build
        from google.oauth2.credentials import Credentials
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="google-api-python-client is not installed. Run: pip install google-api-python-client google-auth"
        )

    creds   = Credentials(token=body.access_token)
    service = build("drive", "v3", credentials=creds)

    # Step 1: Find the "Play Books Notes" folder
    folder_query = (
        "mimeType='application/vnd.google-apps.folder' "
        "and name='Play Books Notes' "
        "and trashed=false"
    )
    folder_res = service.files().list(
        q=folder_query,
        fields="files(id, name)",
        pageSize=5
    ).execute()

    folders = folder_res.get("files", [])
    if not folders:
        return {"status": "No 'Play Books Notes' folder found in Google Drive.", "added": 0}

    folder_id = folders[0]["id"]

    # Step 2: List all Google Docs in that folder
    docs_query = (
        f"'{folder_id}' in parents "
        "and mimeType='application/vnd.google-apps.document' "
        "and trashed=false"
    )
    docs_res = service.files().list(
        q=docs_query,
        fields="files(id, name)",
        pageSize=100
    ).execute()

    docs      = docs_res.get("files", [])
    total_added = 0
    conn        = get_conn()
    cursor      = conn.cursor()

    for doc in docs:
        doc_id   = doc["id"]
        doc_name = doc["name"]

        # Step 3: Export as plain text
        try:
            export_res = service.files().export(
                fileId=doc_id,
                mimeType="text/plain"
            ).execute()
        except Exception:
            continue

        # export() returns bytes
        if isinstance(export_res, bytes):
            raw_text = export_res.decode("utf-8", errors="replace")
        else:
            raw_text = str(export_res)

        # Step 4: Determine title & author from the doc name
        # Play Books names docs like "Book Title - Author Name"
        parts     = doc_name.split(" - ", 1)
        raw_title = parts[0].strip()
        author    = parts[1].strip() if len(parts) > 1 else "Unknown"

        # Step 5: Parse and insert with deduplication
        fragments = parse_playbooks_doc_text(raw_text, raw_title, author)
        for frag in fragments:
            fingerprint = generate_fingerprint(frag["book_title"], frag["content"])
            try:
                cursor.execute(
                    "INSERT INTO highlights (id, book_title, author, content, added_on, source)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (fingerprint, frag["book_title"], frag["author"],
                     frag["content"], frag["meta"], "drive")
                )
                total_added += 1
            except sqlite3.IntegrityError:
                pass  # Already in vault

    conn.commit()
    conn.close()

    print(f"[Mnemo] Drive sync complete. {total_added} new thoughts forged.")
    return {"status": "Drive sync complete", "added": total_added}