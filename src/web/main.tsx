import React from 'react';
import ReactDOM from 'react-dom/client';
import ReviewChat from './ReviewChat.js';
import './styles.css';

const queryMode = new URLSearchParams(window.location.search).get('mode');
const queryBackend = new URLSearchParams(window.location.search).get('backend');
const envMode = import.meta.env.VITE_MCP_MODE;
const envBackendOrigin = import.meta.env.VITE_BACKEND_ORIGIN?.trim() ?? '';
const normalizedQueryMode = queryMode === 'live' || queryMode === 'stub' ? queryMode : null;
const normalizedEnvMode = envMode === 'live' || envMode === 'stub' ? envMode : null;
const isLiveMode = normalizedQueryMode === 'live'
  || (normalizedQueryMode !== 'stub' && (normalizedEnvMode === 'live' || (normalizedEnvMode !== 'stub' && envBackendOrigin.length > 0)));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReviewChat initialMode={isLiveMode ? 'sse' : 'stub'} initialBackendOrigin={queryBackend ?? envBackendOrigin} />
  </React.StrictMode>
);
