import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

const App = () => {
  const [highlight, setHighlight] = useState<{content: string, book_title: string, author: string} | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch from your FastAPI server
    fetch('http://127.0.0.1:8000/highlights/random')
      .then(res => res.json())
      .then(data => {
        setHighlight(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch:", err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading your mind...</div>;
  if (!highlight) return <div>No highlights found. Start saving!</div>;

  return (
    <div style={{ maxWidth: '600px', textAlign: 'center', padding: '20px' }}>
      <blockquote style={{ fontSize: '1.5rem', fontStyle: 'italic', marginBottom: '20px' }}>
        "{highlight.content}"
      </blockquote>
      <div style={{ fontSize: '1rem', color: '#a0a0a0' }}>
        — {highlight.book_title} {highlight.author !== "Unknown" ? `by ${highlight.author}` : ''}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);