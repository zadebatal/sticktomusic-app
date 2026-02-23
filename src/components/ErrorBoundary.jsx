import React from 'react';
import log from '../utils/logger';

/**
 * ErrorBoundary — catches render errors anywhere in the app tree
 * and shows a dark-themed fallback instead of a white crash screen.
 *
 * Must be a class component (React requirement for error boundaries).
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    log.error('[ErrorBoundary] Uncaught render error:', error);
    log.error('[ErrorBoundary] Component stack:', errorInfo?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: '#0a0a0f',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Outfit, system-ui, sans-serif',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '420px', padding: '24px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px' }}>
              Something went wrong
            </h1>
            <p style={{ color: '#a1a1aa', fontSize: '16px', marginBottom: '32px' }}>
              Please refresh the page to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#7c3aed',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 32px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
