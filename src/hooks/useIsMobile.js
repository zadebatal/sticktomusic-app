import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

/**
 * Single source of truth for responsive breakpoints.
 * Replaces duplicated useState+useEffect resize patterns across 11+ components.
 */
export default function useIsMobile() {
  const [state, setState] = useState(() => ({
    isMobile: typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
    isTablet: typeof window !== 'undefined' ? window.innerWidth >= MOBILE_BREAKPOINT && window.innerWidth < TABLET_BREAKPOINT : false,
    windowWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
  }));

  useEffect(() => {
    let rafId;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const w = window.innerWidth;
        setState({
          isMobile: w < MOBILE_BREAKPOINT,
          isTablet: w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT,
          windowWidth: w,
        });
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return state;
}
