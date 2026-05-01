from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware  # <-- NEW IMPORT
from sqlalchemy.orm import Session
from sqlalchemy.sql.expression import func
from . import models, database, schemas
from typing import List, Optional


models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="Mnemo API")

# --- NEW CORS SETUP ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows your browser extension to connect
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ----------------------



def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return {"status": "Mnemo API is running successfully!"}

# --- NEW ROUTES BELOW ---

# 1. Save a new highlight
@app.post("/highlights/", response_model=schemas.HighlightResponse)
def create_highlight(highlight: schemas.HighlightCreate, db: Session = Depends(get_db)):
    # Convert the Pydantic schema to a SQLAlchemy model
    db_highlight = models.Highlight(**highlight.model_dump())
    
    db.add(db_highlight)
    db.commit()
    db.refresh(db_highlight)
    return db_highlight

# 2. Get a random highlight (for your New Tab page)
@app.get("/highlights/random", response_model=schemas.HighlightResponse)
def get_random_highlight(db: Session = Depends(get_db)):
    # Order by random and grab the first one
    random_highlight = db.query(models.Highlight).order_by(func.random()).first()
    
    if not random_highlight:
        raise HTTPException(status_code=404, detail="No highlights found yet. Go read something!")
        
    return random_highlight

# 3. Get ALL highlights (for the Dashboard)
@app.get("/highlights/", response_model=List[schemas.HighlightResponse])
def get_all_highlights(db: Session = Depends(get_db)):
    # Fetch all highlights, newest first
    return db.query(models.Highlight).order_by(models.Highlight.created_at.desc()).all()

# 4. Delete a highlight (The Burn)
@app.delete("/highlights/{highlight_id}")
def delete_highlight(highlight_id: int, db: Session = Depends(get_db)):
    highlight = db.query(models.Highlight).filter(models.Highlight.id == highlight_id).first()
    if not highlight:
        raise HTTPException(status_code=404, detail="Thought not found")
    
    db.delete(highlight)
    db.commit()
    return {"message": "Thought burned to ashes."}