import React from 'react';
import ReactDOM from 'react-dom/client';
import ReviewChat from './ReviewChat.js';
import './styles.css';

const queryMode = new URLSearchParams(window.location.search).get('mode');
const queryBackend = new URLSearchParams(window.location.search).get('backend');
const envMode = import.meta.env.VITE_MCP_MODE;
const isLiveMode = queryMode === 'live' || envMode === 'live';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReviewChat initialMode={isLiveMode ? 'sse' : 'stub'} initialBackendOrigin={queryBackend ?? import.meta.env.VITE_BACKEND_ORIGIN ?? ''} />
  </React.StrictMode>
);
