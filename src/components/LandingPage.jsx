import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from '../ui/components/Button';
import { TextField } from '../ui/components/TextField';
import { IconWithBackground } from '../ui/components/IconWithBackground';
import { Accordion } from '../ui/components/Accordion';
import {
  FeatherArrowRight, FeatherPlay, FeatherVideo, FeatherCalendar,
  FeatherBarChart, FeatherCheck, FeatherX, FeatherLoader, FeatherChevronDown,
  FeatherHelpCircle
} from '@subframe/core';

/**
 * LandingPage — Marketing page shown when user is NOT logged in.
 * Subframe-based design with auth modal overlay.
 */
const LandingPage = ({ onLogin, onSignup, onGoogleAuth, authError, authLoading }) => {
  const { theme } = useTheme();
  const t = theme.tw;
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const navigate = useNavigate();

  // Password reset state
  const [resetMessage, setResetMessage] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);

  // FAQ data
  const faqItems = [
    { q: 'What platforms does StickToMusic support?', a: 'TikTok, Instagram, YouTube, and Facebook. Schedule posts to all platforms from one dashboard.' },
    { q: 'How does the Studio work?', a: 'Upload your clips, photos, and tracks. Our Studio remixes your media into ready-to-post videos and slideshows — professionally cut, synced to your music, at the click of a button.' },
    { q: 'How do I get access?', a: 'Request a demo and we\'ll walk you through the platform. We work directly with labels and artist teams to build a package that fits your roster.' },
    { q: 'How many artists can I manage?', a: 'There\'s no limit. Manage your entire roster from one dashboard — each artist gets their own isolated workspace.' },
    { q: 'Can my team use it too?', a: 'Absolutely. Add managers, collaborators, and artists to your account. Everyone gets the right level of access.' },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (authMode === 'login') onLogin?.(email, password);
    else onSignup?.(email, password, name);
  };

  // Escape-to-close auth modal
  useEffect(() => {
    if (!showAuth) return;
    const handler = (e) => { if (e.key === 'Escape') setShowAuth(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showAuth]);

  const handleForgotPassword = async () => {
    if (!email) {
      setResetMessage({ type: 'error', text: 'Enter your email address above first.' });
      return;
    }
    setResetLoading(true);
    setResetMessage(null);
    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
      setResetMessage({ type: 'success', text: 'Password reset email sent! Check your inbox.' });
    } catch (err) {
      const msg = err.code === 'auth/user-not-found'
        ? 'No account found with that email.'
        : err.code === 'auth/invalid-email'
        ? 'Please enter a valid email address.'
        : 'Could not send reset email. Please try again.';
      setResetMessage({ type: 'error', text: msg });
    }
    setResetLoading(false);
  };

  return (
    <div className="flex h-screen w-full flex-col items-center bg-black overflow-auto focus:outline-none" tabIndex={0}>
      {/* NAV */}
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-200 bg-black px-4 sm:px-12 py-4">
        <span className="text-heading-2 font-heading-2 text-white">StickToMusic</span>
        <div className="flex items-center gap-3">
          <Button variant="brand-tertiary" size="medium" onClick={() => { setAuthMode('login'); setShowAuth(true); }}>
            Log in
          </Button>
          <Button variant="neutral-secondary" size="medium" onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
            Get Started
          </Button>
        </div>
      </div>

      {/* MAIN CONTENT — single centered container */}
      <div className="flex w-full max-w-[1280px] flex-col items-center gap-16 sm:gap-32 bg-black px-4 sm:px-12 py-12 sm:py-24">

        {/* ═══ HERO ═══ */}
        <div className="flex w-full flex-col items-center gap-12">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-8">
            <div className="flex w-full flex-col items-center gap-6">
              <span className="w-full font-['Outfit'] text-[40px] sm:text-[56px] lg:text-[72px] font-[700] leading-[48px] sm:leading-[64px] lg:leading-[80px] text-white text-center -tracking-[0.02em]">
                Your music, everywhere.
              </span>
              <span className="w-full text-heading-2 font-heading-2 text-brand-700 text-center">
                Create videos in seconds, schedule posts across every platform,
                and grow your audience systematically — all in one place.
              </span>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <Button className="min-h-[48px] w-full sm:w-auto px-8" variant="brand-tertiary" size="large" iconRight={<FeatherArrowRight />} onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
                Start Creating
              </Button>
              <Button className="min-h-[48px] w-full sm:w-auto px-8" variant="neutral-secondary" size="large" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
                See How
              </Button>
            </div>
          </div>
        </div>

        {/* ═══ FEATURES ═══ */}
        <div className="flex w-full flex-col items-center gap-16" id="features">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-white text-center">
              Everything you need
            </span>
            <span className="text-body font-body text-brand-900 text-center">
              One tool to create, schedule, and grow across every platform.
            </span>
          </div>
          <div className="w-full items-start gap-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <FeatherVideo />, title: 'Studio', desc: 'Drop in your clips, photos, and tracks. Our studio remixes your own media into hundreds of ready-to-post videos and slideshows — professionally cut, perfectly synced, at the click of a button.' },
              { icon: <FeatherCalendar />, title: 'Scheduler', desc: 'Schedule posts across TikTok, Instagram, YouTube, and Facebook from one dashboard. Stay consistent without the daily grind.' },
              { icon: <FeatherBarChart />, title: 'Analytics', desc: 'Track performance across all platforms. See what works, optimize your strategy, and grow your audience systematically.' },
            ].map((f, i) => (
              <div key={i} className="flex grow shrink-0 basis-0 flex-col items-start gap-4">
                <IconWithBackground className="h-12 w-12 flex-none mx-auto" variant="neutral" size="large" icon={f.icon} square={false} />
                <div className="flex w-full flex-col items-start gap-2">
                  <span className="w-full text-heading-2 font-heading-2 text-white text-center">{f.title}</span>
                  <span className="text-body font-body text-brand-900 text-center">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ HOW IT WORKS ═══ */}
        <div className="flex w-full flex-col items-center gap-16">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-white text-center">
              How it works
            </span>
          </div>
          <div className="w-full items-start gap-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { num: '1', title: 'Connect your pages', desc: 'Link your TikTok, Instagram, YouTube, and Facebook accounts in seconds.' },
              { num: '2', title: 'Create content', desc: 'Drop in your clips, photos, and tracks — our studio remixes them into hundreds of ready-to-post videos and slideshows at the click of a button.' },
              { num: '3', title: 'Schedule & grow', desc: 'Queue your posts, track analytics, and watch your audience grow across every platform.' },
            ].map((step, i) => (
              <div key={i} className="flex grow shrink-0 basis-0 flex-col items-center gap-4">
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-neutral-100">
                  <span className="text-heading-2 font-heading-2 text-black">{step.num}</span>
                </div>
                <div className="flex w-full flex-col items-center gap-2">
                  <span className="text-heading-3 font-heading-3 text-white text-center">{step.title}</span>
                  <span className="text-body font-body text-brand-900 text-center">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ REQUEST A DEMO ═══ */}
        <div className="flex w-full flex-col items-center gap-8">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-white text-center">
              See it in action
            </span>
            <span className="text-body font-body text-brand-900 text-center">
              We work directly with labels and artist teams. Request a demo and we'll show you how StickToMusic fits your roster.
            </span>
          </div>
          <Button className="min-h-[48px] px-10" variant="brand-tertiary" size="large" iconRight={<FeatherArrowRight />} onClick={() => window.location.href = 'mailto:zadebatal@gmail.com?subject=StickToMusic Demo Request'}>
            Request a Demo
          </Button>
        </div>

        {/* ═══ FAQ ═══ */}
        <div className="flex w-full flex-col items-center gap-12">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-white text-center">
              Frequently asked questions
            </span>
            <span className="text-body font-body text-brand-900 text-center">
              Everything you need to know about StickToMusic.
            </span>
          </div>
          <div className="flex w-full max-w-[768px] flex-col items-start gap-0">
            {faqItems.map((item, i) => (
              <Accordion
                key={i}
                trigger={
                  <div className="flex w-full items-center justify-between py-5 border-b border-solid border-neutral-200">
                    <span className="text-body-bold font-body-bold text-white">{item.q}</span>
                    <Accordion.Chevron />
                  </div>
                }
              >
                <div className="pb-5 border-b border-solid border-neutral-200">
                  <span className="text-body font-body text-brand-900">{item.a}</span>
                </div>
              </Accordion>
            ))}
          </div>
        </div>

        {/* ═══ CTA ═══ */}
        <div className="flex w-full flex-col items-center gap-6 rounded-lg bg-black px-6 sm:px-12 py-16">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-white text-center">Ready to create?</span>
            <span className="text-body font-body text-brand-900 text-center">
              Join hundreds of artists growing their audience with StickToMusic.
            </span>
          </div>
          <Button className="min-h-[48px] px-10" variant="brand-tertiary" size="large" iconRight={<FeatherArrowRight />} onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
            Get Started
          </Button>
        </div>

      </div>

      {/* FOOTER */}
      <div className="flex w-full flex-col sm:flex-row items-center justify-between border-t border-solid border-neutral-200 bg-black px-4 sm:px-12 py-8 gap-4">
        <span className="text-caption font-caption text-neutral-400">&copy; 2026 StickToMusic</span>
        <div className="flex items-center gap-6">
          <button onClick={() => navigate('/terms')} className="text-caption font-caption text-neutral-400 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-0">Terms of Service</button>
          <button onClick={() => navigate('/privacy')} className="text-caption font-caption text-neutral-400 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-0">Privacy Policy</button>
          <a href="mailto:support@sticktomusic.com" className="text-caption font-caption text-neutral-400 hover:text-white transition-colors no-underline">Contact</a>
        </div>
      </div>

      {/* AUTH MODAL */}
      {showAuth && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuth(false); }}
        >
          <div className="bg-[#0a0a0aff] border border-solid border-neutral-200 rounded-xl w-full max-w-md mx-4 px-8 py-8">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <span className="text-heading-2 font-heading-2 text-white block">
                {authMode === 'login' ? 'Welcome back' : 'Create your account'}
              </span>
              <button
                onClick={() => { setShowAuth(false); setResetMessage(null); }}
                className="flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              >
                <FeatherX className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center rounded-lg border border-solid border-neutral-200 bg-black px-1 py-1 mb-6" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'login'}
                className={`flex flex-1 h-9 items-center justify-center rounded-md cursor-pointer transition-colors border-none bg-transparent ${authMode === 'login' ? 'bg-neutral-200' : ''}`}
                onClick={() => { setAuthMode('login'); setResetMessage(null); }}
              >
                <span className={`text-sm ${authMode === 'login' ? 'text-default-font font-semibold' : 'text-neutral-400'}`}>
                  Login
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'signup'}
                className={`flex flex-1 h-9 items-center justify-center rounded-md cursor-pointer transition-colors border-none bg-transparent ${authMode === 'signup' ? 'bg-neutral-200' : ''}`}
                onClick={() => { setAuthMode('signup'); setResetMessage(null); }}
              >
                <span className={`text-sm ${authMode === 'signup' ? 'text-default-font font-semibold' : 'text-neutral-400'}`}>
                  Sign Up
                </span>
              </button>
            </div>

            {authError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {authError}
              </div>
            )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                {authMode === 'signup' && (
                  <TextField label="Name">
                    <TextField.Input
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </TextField>
                )}
                <TextField label="Email">
                  <TextField.Input
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </TextField>
                <div className="flex flex-col gap-1">
                  <TextField label="Password">
                    <TextField.Input
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                    />
                  </TextField>
                  {authMode === 'login' && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={resetLoading}
                      className="self-end text-xs text-brand-700 hover:text-white transition-colors cursor-pointer bg-transparent border-none p-0 mt-1 disabled:opacity-50"
                    >
                      {resetLoading ? 'Sending...' : 'Forgot password?'}
                    </button>
                  )}
                  {resetMessage && (
                    <div className={`mt-1 text-xs ${resetMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {resetMessage.text}
                    </div>
                  )}
                </div>
                {authMode === 'signup' && (
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-neutral-600 accent-brand-600 flex-shrink-0"
                      aria-label="Agree to terms"
                    />
                    <span className="text-xs text-neutral-400">
                      I agree to the{' '}
                      <button type="button" onClick={() => navigate('/terms')} className="text-brand-700 hover:text-white underline bg-transparent border-none p-0 cursor-pointer text-xs">Terms of Service</button>
                      {' '}and{' '}
                      <button type="button" onClick={() => navigate('/privacy')} className="text-brand-700 hover:text-white underline bg-transparent border-none p-0 cursor-pointer text-xs">Privacy Policy</button>
                    </span>
                  </label>
                )}
                <Button className="w-full min-h-[44px]" type="submit" variant="brand-primary" size="large" disabled={authLoading || (authMode === 'signup' && !agreedToTerms)}>
                  {authLoading ? (
                    <span className="flex items-center gap-2">
                      <FeatherLoader className="w-4 h-4 animate-spin" />
                      {authMode === 'login' ? 'Logging in...' : 'Signing up...'}
                    </span>
                  ) : authMode === 'login' ? 'Log In' : 'Sign Up'}
                </Button>
                {authMode === 'signup' && !agreedToTerms && (
                  <span className="text-xs text-neutral-400 text-center">Agree to Terms to continue</span>
                )}
              </form>

              <div className="my-5 flex items-center gap-3">
                <div className="flex-1 h-px bg-neutral-100" />
                <span className="text-caption font-caption text-neutral-400">or</span>
                <div className="flex-1 h-px bg-neutral-100" />
              </div>
              <Button className="w-full min-h-[44px]" variant="neutral-secondary" size="large" disabled={authLoading} onClick={onGoogleAuth}>
                {authLoading ? (
                  <span className="flex items-center gap-2">
                    <FeatherLoader className="w-4 h-4 animate-spin" />
                    Signing in...
                  </span>
                ) : 'Continue with Google'}
              </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
