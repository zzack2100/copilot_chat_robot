import React from 'react';
import ReactDOM from 'react-dom/client';
import ReviewChat from './ReviewChat.js';
import './styles.css';

const queryMode = new URLSearchParams(window.location.search).get('mode');
const envMode = import.meta.env.VITE_MCP_MODE;
const isLiveMode = queryMode === 'live' || envMode === 'live';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReviewChat mode={isLiveMode ? 'sse' : 'stub'} />
  </React.StrictMode>
);
