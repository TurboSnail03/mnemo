import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: 'red', padding: '20px', background: 'black', height: '100vh', zIndex: 9999, position: 'relative' }}>
        <h2>Something went wrong.</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.toString()}</pre>
      </div>;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
