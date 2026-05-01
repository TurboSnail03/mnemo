from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# The base shape of a highlight
class HighlightBase(BaseModel):
    content: str
    book_title: Optional[str] = "Web Snippet"
    author: Optional[str] = "Unknown"
    url: Optional[str] = None
    tags: List[str] = []

# What we expect when the extension sends data
class HighlightCreate(HighlightBase):
    pass

# What the API sends back (includes the DB-generated ID and timestamp)
class HighlightResponse(HighlightBase):
    id: int
    created_at: datetime
    user_id: Optional[int] = None

    class Config:
        from_attributes = True