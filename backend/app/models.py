from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="USER") # You will be set to "ADMIN"
    storage_limit_mb = Column(Integer, default=50) # Regular users get 50MB

    # Establishes the link to the highlights table
    highlights = relationship("Highlight", back_populates="owner")

class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    content = Column(Text, nullable=False)
    book_title = Column(String, index=True)
    author = Column(String)
    url = Column(String, nullable=True)
    tags = Column(JSON, default=list) 
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Links back to the user who created it
    owner = relationship("User", back_populates="highlights")