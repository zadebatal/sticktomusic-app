import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useTheme } from '../contexts/ThemeContext';
import { calculateOperatorPrice } from '../services/subscriptionService';
import { Button } from '../ui/components/Button';
import { Badge } from '../ui/components/Badge';
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
  const [selectedTier, setSelectedTier] = useState(null);
  const [pricingTab, setPricingTab] = useState('artist');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const navigate = useNavigate();

  // Password reset state
  const [resetMessage, setResetMessage] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);

  // Operator calculator state
  const [opArtists, setOpArtists] = useState('5');
  const [opSetsPerArtist, setOpSetsPerArtist] = useState('10');
  const operatorPrice = calculateOperatorPrice(parseInt(opArtists) || 0, parseInt(opSetsPerArtist) || 0);

  // FAQ data
  const faqItems = [
    { q: 'What is a Social Set?', a: 'A Social Set covers one artist across all platforms — Facebook, TikTok, Twitter, and Instagram. Each set lets you manage content and scheduling for one artist on all four platforms.' },
    { q: 'What platforms does StickToMusic support?', a: 'TikTok, Instagram, YouTube, and Facebook. Schedule posts to all platforms from one dashboard.' },
    { q: 'How does the Studio work?', a: 'Upload your clips, photos, and tracks. Our Studio remixes your media into ready-to-post videos and slideshows — professionally cut, synced to your music, at the click of a button.' },
    { q: 'Can I try it before I buy?', a: 'Contact us for a demo. We\'ll walk you through the platform and set up your first project.' },
    { q: 'How many team members can I add?', a: 'Each operator account can manage multiple artists with unlimited collaborators.' },
    { q: 'What happens if I need more Social Sets later?', a: 'You can upgrade your plan at any time. Your content, scheduled posts, and analytics carry over seamlessly.' },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (authMode === 'login') onLogin?.(email, password);
    else onSignup?.(email, password, name);
  };

  const handleTierClick = (tier) => {
    setSelectedTier(tier);
    setAuthMode('signup');
    setShowAuth(true);
  };

  const handleApply = async (tierSets, tierName, role = 'artist') => {
    if (!email) { setCheckoutError('Please enter your email first'); return; }
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase(), name: name || email.split('@')[0], tier: tierName, sets: tierSets, role }),
      });
      const data = await response.json();
      if (data.success) setApplicationSubmitted(true);
      else setCheckoutError(data.error || 'Failed to submit application');
    } catch (err) { setCheckoutError('Could not submit application. Please try again.'); }
    setCheckoutLoading(false);
  };

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

  const tierCards = [
    { name: 'Starter', price: '$500', sets: 5, features: ['5 Social Sets', 'Unlimited posts', 'Full analytics', 'Priority support'] },
    { name: 'Growth', price: '$1,000', sets: 10, features: ['10 Social Sets', 'Unlimited posts', 'Full analytics', 'Priority support'], popular: true },
    { name: 'Scale', price: '$2,500', sets: 25, features: ['25 Social Sets', 'Unlimited posts', 'Full analytics', 'Priority support'] },
    { name: 'Sensation', price: '$5,000', sets: 50, features: ['50 Social Sets', 'Unlimited posts', 'Full analytics', 'Priority support'] },
  ];

  return (
    <div className="flex h-full w-full flex-col items-center bg-black">
      {/* NAV */}
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 bg-black px-4 sm:px-12 py-4">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">StickToMusic</span>
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
              <span className="w-full font-['Outfit'] text-[40px] sm:text-[56px] lg:text-[72px] font-[700] leading-[48px] sm:leading-[64px] lg:leading-[80px] text-[#ffffffff] text-center -tracking-[0.02em]">
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
            <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center">
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
                  <span className="w-full text-heading-2 font-heading-2 text-[#ffffffff] text-center">{f.title}</span>
                  <span className="text-body font-body text-brand-900 text-center">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ HOW IT WORKS ═══ */}
        <div className="flex w-full flex-col items-center gap-16">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center">
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
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-neutral-800">
                  <span className="text-heading-2 font-heading-2 text-[#000000ff]">{step.num}</span>
                </div>
                <div className="flex w-full flex-col items-center gap-2">
                  <span className="text-heading-3 font-heading-3 text-[#ffffffff] text-center">{step.title}</span>
                  <span className="text-body font-body text-brand-900 text-center">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ PRICING ═══ */}
        <div className="flex w-full flex-col items-center gap-12">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center">
              Simple pricing
            </span>
            <span className="text-body font-body text-brand-900 text-center">
              Every plan includes unlimited posts, full analytics, and priority support. Pick the plan that fits how many pages you manage.
            </span>
            <span className="text-caption font-caption text-brand-700 text-center mt-1">
              1 Social Set = Facebook + TikTok + Twitter + Instagram
            </span>
          </div>

          {/* Tab toggle */}
          <div className="flex items-center rounded-lg border border-solid border-neutral-800 bg-black px-1 py-1">
            <div
              className={`flex h-10 items-center justify-center rounded-md px-4 py-2 cursor-pointer ${pricingTab === 'artist' ? 'bg-neutral-100' : ''}`}
              onClick={() => setPricingTab('artist')}
            >
              <span className={`${pricingTab === 'artist' ? 'text-body-bold font-body-bold text-default-font' : 'text-body font-body text-brand-700'}`}>
                Artist
              </span>
            </div>
            <div
              className={`flex h-10 items-center justify-center rounded-md px-4 py-2 cursor-pointer ${pricingTab === 'operator' ? 'bg-neutral-100' : ''}`}
              onClick={() => setPricingTab('operator')}
            >
              <span className={`${pricingTab === 'operator' ? 'text-body-bold font-body-bold text-default-font' : 'text-body font-body text-brand-700'}`}>
                Operator
              </span>
            </div>
          </div>

          {/* Pricing container */}
          <div className="flex w-full flex-col items-start gap-6 rounded-lg border border-solid border-neutral-800 bg-[#000000ff] px-8 py-8">
            {/* Tier cards */}
            {pricingTab === 'artist' && (
              <div className="w-full items-start gap-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {tierCards.map((tier, i) => (
                  <div
                    key={i}
                    className={`flex grow shrink-0 basis-0 flex-col items-start gap-6 rounded-md px-6 py-8 ${
                      tier.popular
                        ? 'border-2 border-solid border-brand-primary bg-black'
                        : 'border border-solid border-neutral-800 bg-black'
                    }`}
                  >
                    <div className="flex w-full flex-col items-start gap-2">
                      {tier.popular ? (
                        <div className="flex w-full items-center gap-2">
                          <span className="grow shrink-0 basis-0 text-heading-3 font-heading-3 text-[#ffffffff]">{tier.name}</span>
                          <Badge variant="brand">POPULAR</Badge>
                        </div>
                      ) : (
                        <span className="text-heading-3 font-heading-3 text-[#ffffffff]">{tier.name}</span>
                      )}
                      <div className="flex gap-1 items-baseline">
                        <span className="font-['Outfit'] text-[36px] font-[700] leading-[40px] text-[#ffffffff]">{tier.price}</span>
                        <span className="text-body font-body text-brand-900">/mo</span>
                      </div>
                    </div>
                    <div className="flex w-full flex-col items-start gap-3">
                      {tier.features.map((f, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <FeatherCheck className="text-body font-body text-[#ffffffff]" />
                          <span className="text-body font-body text-brand-900">{f}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      className="h-10 w-full flex-none"
                      variant="neutral-secondary"
                      size="large"
                      onClick={() => handleTierClick(tier)}
                    >
                      Get Started
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Operator calculator */}
            {pricingTab === 'operator' && (
              <div className="flex w-full flex-col items-start gap-4 rounded-md border border-solid border-neutral-800 bg-black px-6 py-6">
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Operator Pricing</span>
                <span className="text-body font-body text-brand-900">
                  Managing multiple artists? Pay only for what you need: Artists × Social Sets × $100/set per month.
                </span>
                <div className="flex w-full items-center gap-4">
                  <TextField className="h-auto grow shrink-0 basis-0" label="Number of Artists" helpText="">
                    <TextField.Input
                      placeholder="e.g. 5"
                      value={opArtists}
                      onChange={(e) => setOpArtists(e.target.value)}
                    />
                  </TextField>
                  <TextField className="h-auto grow shrink-0 basis-0" label="Sets per Artist" helpText="">
                    <TextField.Input
                      placeholder="e.g. 10"
                      value={opSetsPerArtist}
                      onChange={(e) => setOpSetsPerArtist(e.target.value)}
                    />
                  </TextField>
                </div>
                <div className="flex w-full gap-2 items-baseline">
                  <span className="text-caption font-caption text-brand-900">Estimated monthly cost:</span>
                  <span className="font-['Outfit'] text-[28px] font-[700] leading-[32px] text-[#ffffffff]">
                    ${operatorPrice.toLocaleString()}
                  </span>
                  <span className="text-body font-body text-brand-900">/mo</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ FAQ ═══ */}
        <div className="flex w-full flex-col items-center gap-12">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center">
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
                  <div className="flex w-full items-center justify-between py-5 border-b border-solid border-neutral-800">
                    <span className="text-body-bold font-body-bold text-[#ffffffff]">{item.q}</span>
                    <Accordion.Chevron />
                  </div>
                }
              >
                <div className="pb-5 border-b border-solid border-neutral-800">
                  <span className="text-body font-body text-brand-900">{item.a}</span>
                </div>
              </Accordion>
            ))}
          </div>
        </div>

        {/* ═══ CTA ═══ */}
        <div className="flex w-full flex-col items-center gap-6 rounded-lg bg-[#000000ff] px-6 sm:px-12 py-16">
          <div className="flex w-full max-w-[768px] flex-col items-center gap-4">
            <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center">Ready to create?</span>
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
      <div className="flex w-full flex-col sm:flex-row items-center justify-between border-t border-solid border-neutral-800 bg-black px-4 sm:px-12 py-8 gap-4">
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
          <div className="bg-[#0a0a0aff] border border-solid border-neutral-800 rounded-xl w-full max-w-md mx-4 px-8 py-8">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <span className="text-heading-2 font-heading-2 text-[#ffffffff] block">
                  {authMode === 'login' ? 'Welcome back' : 'Create your account'}
                </span>
                {selectedTier && authMode === 'signup' && (
                  <p className="text-caption font-caption text-neutral-400 mt-1">
                    {selectedTier.name} plan — {selectedTier.sets} Social Sets — {selectedTier.price}/mo
                  </p>
                )}
              </div>
              <button
                onClick={() => { setShowAuth(false); setSelectedTier(null); setCheckoutError(null); setResetMessage(null); }}
                className="flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              >
                <FeatherX className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center rounded-lg border border-solid border-neutral-800 bg-black px-1 py-1 mb-6">
              <div
                className={`flex flex-1 h-9 items-center justify-center rounded-md cursor-pointer transition-colors ${authMode === 'login' ? 'bg-neutral-100' : ''}`}
                onClick={() => { setAuthMode('login'); setCheckoutError(null); setResetMessage(null); }}
              >
                <span className={`text-sm ${authMode === 'login' ? 'text-default-font font-semibold' : 'text-neutral-400'}`}>
                  Login
                </span>
              </div>
              <div
                className={`flex flex-1 h-9 items-center justify-center rounded-md cursor-pointer transition-colors ${authMode === 'signup' ? 'bg-neutral-100' : ''}`}
                onClick={() => { setAuthMode('signup'); setCheckoutError(null); setResetMessage(null); }}
              >
                <span className={`text-sm ${authMode === 'signup' ? 'text-default-font font-semibold' : 'text-neutral-400'}`}>
                  Sign Up
                </span>
              </div>
            </div>

            {applicationSubmitted && (
              <div className="mb-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm text-center">
                <p className="font-semibold mb-1">Application submitted!</p>
                <p>We'll review your application and get back to you shortly.</p>
              </div>
            )}

            {(authError || checkoutError) && !applicationSubmitted && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {authError || checkoutError}
              </div>
            )}

            {!applicationSubmitted && (
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
                <Button className="w-full min-h-[44px]" variant="brand-primary" size="large" disabled={authLoading || checkoutLoading || (authMode === 'signup' && !agreedToTerms)} onClick={handleSubmit}>
                  {authLoading ? (
                    <span className="flex items-center gap-2">
                      <FeatherLoader className="w-4 h-4 animate-spin" />
                      {authMode === 'login' ? 'Logging in...' : 'Signing up...'}
                    </span>
                  ) : authMode === 'login' ? 'Log In' : 'Sign Up'}
                </Button>
              </form>
            )}

            {!applicationSubmitted && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <div className="flex-1 h-px bg-neutral-800" />
                  <span className="text-caption font-caption text-neutral-400">or</span>
                  <div className="flex-1 h-px bg-neutral-800" />
                </div>
                <Button className="w-full min-h-[44px]" variant="neutral-secondary" size="large" disabled={authLoading} onClick={onGoogleAuth}>
                  {authLoading ? (
                    <span className="flex items-center gap-2">
                      <FeatherLoader className="w-4 h-4 animate-spin" />
                      Signing in...
                    </span>
                  ) : 'Continue with Google'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
