import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { calculateOperatorPrice } from '../services/subscriptionService';
import { Button } from '../ui/components/Button';
import { Badge } from '../ui/components/Badge';
import { TextField } from '../ui/components/TextField';
import {
  FeatherArrowRight, FeatherPlay, FeatherVideo, FeatherCalendar,
  FeatherBarChart2, FeatherCheck, FeatherX
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

  // Operator calculator state
  const [opArtists, setOpArtists] = useState('5');
  const [opSetsPerArtist, setOpSetsPerArtist] = useState('10');
  const operatorPrice = calculateOperatorPrice(parseInt(opArtists) || 0, parseInt(opSetsPerArtist) || 0);

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

  const tierCards = [
    { name: 'Starter', price: '$500', sets: 5, features: ['5 Social Sets', 'Unlimited videos', 'Basic analytics'] },
    { name: 'Growth', price: '$1,000', sets: 10, features: ['10 Social Sets', 'Unlimited videos', 'Advanced analytics'], popular: true },
    { name: 'Scale', price: '$2,500', sets: 25, features: ['25 Social Sets', 'Unlimited videos', 'Priority support'] },
    { name: 'Sensation', price: '$5,000', sets: 50, features: ['50 Social Sets', 'Unlimited videos', 'Dedicated support'] },
  ];

  return (
    <div className="flex h-full w-full flex-col items-center bg-black">
      {/* NAV */}
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 bg-black px-8 py-4">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">StickToMusic</span>
        <div className="flex items-center gap-3">
          <Button variant="neutral-tertiary" size="medium" onClick={() => { setAuthMode('login'); setShowAuth(true); }}>
            Log in
          </Button>
          <Button variant="brand-primary" size="medium" onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
            Get Started
          </Button>
        </div>
      </div>

      {/* HERO */}
      <div className="flex w-full flex-col items-center bg-black px-8 py-24 text-center">
        <span className="max-w-4xl font-['Outfit'] text-[72px] font-[700] leading-tight text-[#ffffffff] -tracking-[0.02em]">
          Your music, everywhere.
        </span>
        <span className="text-xl text-neutral-400 max-w-2xl mx-auto mt-6">
          Create videos in seconds, schedule posts across every platform,
          and grow your audience systematically — all in one place.
        </span>
        <div className="flex items-center gap-4 mt-10">
          <Button variant="brand-primary" size="large" iconRight={<FeatherArrowRight />} onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
            Start Creating
          </Button>
          <Button variant="neutral-secondary" size="large" icon={<FeatherPlay />} onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
            See How
          </Button>
        </div>
      </div>

      {/* FEATURES */}
      <div className="bg-[#0a0a0aff] px-8 py-20 w-full" id="features">
        <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center block">
          Everything you need
        </span>
        <p className="text-body font-body text-neutral-400 text-center mt-4 max-w-2xl mx-auto">
          One tool to create, schedule, and grow across every platform.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-12">
          {[
            { icon: <FeatherVideo className="text-white w-6 h-6" />, title: 'Studio', desc: 'Batch-create beat-synced videos and slideshows in minutes. Upload your music, add visuals, and export ready-to-post content.' },
            { icon: <FeatherCalendar className="text-white w-6 h-6" />, title: 'Scheduler', desc: 'Schedule posts across TikTok, Instagram, YouTube, and Facebook from one dashboard. Stay consistent without the daily grind.' },
            { icon: <FeatherBarChart2 className="text-white w-6 h-6" />, title: 'Analytics', desc: 'Track performance across all platforms. See what works, optimize your strategy, and grow your audience systematically.' },
          ].map((f, i) => (
            <div key={i} className="rounded-xl border border-neutral-800 bg-[#1a1a1aff] px-8 py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600 mb-4">
                {f.icon}
              </div>
              <span className="text-heading-3 font-heading-3 text-[#ffffffff] block">{f.title}</span>
              <span className="text-body font-body text-neutral-400 mt-2 block">{f.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="bg-black px-8 py-20 w-full">
        <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center block">How it works</span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-12">
          {[
            { num: '1', title: 'Connect your pages', desc: 'Link your TikTok, Instagram, YouTube, and Facebook accounts in seconds.' },
            { num: '2', title: 'Create content', desc: 'Use our studio to remix your videos and slideshows that sync perfectly to the music of your choice.' },
            { num: '3', title: 'Schedule & grow', desc: 'Queue your posts, track analytics, and watch your audience grow across every platform.' },
          ].map((step, i) => (
            <div key={i} className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand-600">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{step.num}</span>
              </div>
              <span className="text-heading-3 font-heading-3 text-[#ffffffff]">{step.title}</span>
              <span className="text-body font-body text-neutral-400">{step.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* PRICING */}
      <div className="bg-black px-8 py-20 w-full" id="pricing">
        <span className="text-heading-1 font-heading-1 text-[#ffffffff] text-center block">Simple pricing</span>
        <p className="text-body font-body text-neutral-400 text-center mt-4 max-w-2xl mx-auto">
          1 Social Set = Facebook + TikTok + Twitter + Instagram. Scale as you grow.
        </p>

        {/* Tab toggle */}
        <div className="flex items-center justify-center mt-10">
          <div className="flex items-center rounded-lg border border-solid border-neutral-800 bg-black px-1 py-1">
            <div
              className={`flex h-10 items-center justify-center rounded-md px-4 py-2 cursor-pointer ${pricingTab === 'artist' ? 'bg-neutral-100' : ''}`}
              onClick={() => setPricingTab('artist')}
            >
              <span className={`${pricingTab === 'artist' ? 'text-body-bold font-body-bold text-default-font' : 'text-body font-body text-neutral-400'}`}>
                Artist
              </span>
            </div>
            <div
              className={`flex h-10 items-center justify-center rounded-md px-4 py-2 cursor-pointer ${pricingTab === 'operator' ? 'bg-neutral-100' : ''}`}
              onClick={() => setPricingTab('operator')}
            >
              <span className={`${pricingTab === 'operator' ? 'text-body-bold font-body-bold text-default-font' : 'text-body font-body text-neutral-400'}`}>
                Operator
              </span>
            </div>
          </div>
        </div>

        {/* Tier cards */}
        {pricingTab === 'artist' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto mt-12">
            {tierCards.map((tier, i) => (
              <div
                key={i}
                className={`rounded-xl px-6 py-8 flex flex-col ${
                  tier.popular
                    ? 'border-2 border-solid border-brand-600 bg-[#1a1a1aff]'
                    : 'border border-solid border-neutral-800 bg-[#1a1a1aff]'
                }`}
              >
                <div className="flex w-full flex-col items-start gap-2 mb-6">
                  {tier.popular ? (
                    <div className="flex w-full items-center gap-2">
                      <span className="grow shrink-0 basis-0 text-heading-3 font-heading-3 text-[#ffffffff]">{tier.name}</span>
                      <Badge variant="brand">Popular</Badge>
                    </div>
                  ) : (
                    <span className="text-heading-3 font-heading-3 text-[#ffffffff]">{tier.name}</span>
                  )}
                  <div className="flex gap-1 items-baseline">
                    <span className="text-heading-1 font-heading-1 text-[#ffffffff]">{tier.price}</span>
                    <span className="text-body font-body text-neutral-400">/mo</span>
                  </div>
                </div>
                <div className="flex w-full flex-col items-start gap-3 mb-8">
                  {tier.features.map((f, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <FeatherCheck className="text-brand-600 w-4 h-4 flex-none" />
                      <span className="text-body font-body text-neutral-400">{f}</span>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full mt-auto"
                  variant={tier.popular ? 'brand-primary' : 'neutral-secondary'}
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
          <div className="max-w-2xl mx-auto mt-12 rounded-xl border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-8">
            <span className="text-heading-3 font-heading-3 text-[#ffffffff] block mb-2">Operator Pricing</span>
            <span className="text-body font-body text-neutral-400 block mb-6">
              Managing multiple artists? Pay only for what you need: Artists x Social Sets x $100/set per month.
            </span>
            <div className="flex w-full items-center gap-4 mb-4">
              <TextField className="h-auto grow shrink-0 basis-0" label="Number of Artists">
                <TextField.Input
                  placeholder="e.g. 5"
                  value={opArtists}
                  onChange={(e) => setOpArtists(e.target.value)}
                />
              </TextField>
              <TextField className="h-auto grow shrink-0 basis-0" label="Sets per Artist">
                <TextField.Input
                  placeholder="e.g. 10"
                  value={opSetsPerArtist}
                  onChange={(e) => setOpSetsPerArtist(e.target.value)}
                />
              </TextField>
            </div>
            <div className="flex w-full gap-2 items-baseline mb-6">
              <span className="text-caption font-caption text-neutral-400">Estimated monthly cost:</span>
              <span className="font-['Outfit'] text-[28px] font-[700] leading-[32px] text-[#ffffffff]">
                ${operatorPrice.toLocaleString()}
              </span>
              <span className="text-body font-body text-neutral-400">/mo</span>
            </div>
            <Button className="w-full" variant="brand-primary" size="large" onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
              Get Started as Operator
            </Button>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="bg-[#0a0a0aff] px-8 py-20 w-full">
        <div className="max-w-3xl mx-auto text-center">
          <span className="text-heading-1 font-heading-1 text-[#ffffffff] block">Ready to create?</span>
          <span className="text-body font-body text-neutral-400 block mt-4">
            Join hundreds of artists growing their audience with StickToMusic.
          </span>
          <div className="mt-8 flex justify-center">
            <Button variant="brand-primary" size="large" iconRight={<FeatherArrowRight />} onClick={() => { setAuthMode('signup'); setShowAuth(true); }}>
              Get Started
            </Button>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="flex w-full items-center justify-center border-t border-solid border-neutral-800 bg-black px-8 py-8">
        <span className="text-caption font-caption text-neutral-400">&copy; 2026 StickToMusic</span>
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
                onClick={() => { setShowAuth(false); setSelectedTier(null); setCheckoutError(null); }}
                className="flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              >
                <FeatherX className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center rounded-lg border border-solid border-neutral-800 bg-black px-1 py-1 mb-6">
              <div
                className={`flex flex-1 h-9 items-center justify-center rounded-md cursor-pointer transition-colors ${authMode === 'login' ? 'bg-neutral-100' : ''}`}
                onClick={() => { setAuthMode('login'); setCheckoutError(null); }}
              >
                <span className={`text-sm ${authMode === 'login' ? 'text-default-font font-semibold' : 'text-neutral-400'}`}>
                  Login
                </span>
              </div>
              <div
                className={`flex flex-1 h-9 items-center justify-center rounded-md cursor-pointer transition-colors ${authMode === 'signup' ? 'bg-neutral-100' : ''}`}
                onClick={() => { setAuthMode('signup'); setCheckoutError(null); }}
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
                <TextField label="Password">
                  <TextField.Input
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                  />
                </TextField>
                <Button className="w-full" variant="brand-primary" size="large" disabled={authLoading || checkoutLoading} onClick={handleSubmit}>
                  {authLoading ? 'Loading...' : authMode === 'login' ? 'Log In' : 'Sign Up'}
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
                <Button className="w-full" variant="neutral-secondary" size="large" onClick={onGoogleAuth}>
                  Continue with Google
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
