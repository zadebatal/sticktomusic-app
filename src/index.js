import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary';

// React Grab — use via `npx react-grab@latest` (not bundled)

// Initialize Microsoft Clarity analytics (heatmaps, session replay, rage clicks)
if (process.env.REACT_APP_CLARITY_PROJECT_ID) {
  import('clarity-js').then(({ clarity }) => {
    clarity.start({
      projectId: process.env.REACT_APP_CLARITY_PROJECT_ID,
      upload: 'https://www.clarity.ms/collect',
      track: true,
      content: true,
    });
  });
}

// Initialize Sentry error monitoring lazily (only if DSN is configured)
if (process.env.REACT_APP_SENTRY_DSN) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: process.env.REACT_APP_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
    });
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
