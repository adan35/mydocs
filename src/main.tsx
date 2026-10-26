import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { registerServiceWorker } from './pwa/register';
import { cloudAvailable } from './app/cloud';

registerServiceWorker();
// Live editing (and its Yjs code) is only loaded when sharing is set up for this site.
if (cloudAvailable) void import('./app/collab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
