import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * LandingPage — Marketing page shown when user is NOT logged in.
 * Replaces old home/how/pricing pages. Includes auth modal.
 */
const LandingPage = ({ onLogin, onSignup, onGoogleAuth, authError, authLoading }) => {
  const { theme } = useTheme();
  const t = theme.tw;
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (authMode === 'login') onLogin?.(email, password);
    else onSignup?.(email, password, name);
  };

  return (
    <div className={`min-h-screen ${t.bgPage} ${t.textPrimary} font-sans`}>
      {/* ═══ NAV ═══ */}
      <nav className={`fixed top-0 left-0 right-0 z-50 ${t.bgPage}/90 backdrop-blur-md border-b ${t.borderSubtle}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className={`text-lg font-bold tracking-tight ${t.textPrimary}`}>StickToMusic</span>
          <div className="flex items-center gap-4">
            <button onClick={() => { setAuthMode('login'); setShowAuth(true); }} className={`text-sm font-medium ${t.textSecondary} ${t.hoverText} transition`}>
              Log in
            </button>
            <button onClick={() => { setAuthMode('signup'); setShowAuth(true); }} className={`px-4 py-2 rounded-full text-sm font-semibold transition ${t.btnPrimary}`}>
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="min-h-screen flex flex-col justify-center items-center text-center px-6 pt-16">
        <div className="max-w-3xl">
          <h1 className={`text-5xl md:text-7xl font-bold leading-tight mb-6 ${t.textPrimary}`}>
            Content at<br />lightning speed.
          </h1>
          <p className={`text-xl md:text-2xl ${t.textSecondary} max-w-xl mx-auto mb-10`}>
            Create, schedule, and analyze content across TikTok, Instagram, YouTube, and Facebook — all from one studio.
          </p>
          <div className="flex gap-4 flex-wrap justify-center">
            <button onClick={() => { setAuthMode('signup'); setShowAuth(true); }} className={`px-8 py-4 rounded-full text-lg font-semibold transition ${t.btnPrimary}`}>
              Start Creating →
            </button>
            <a href="#features" className={`px-8 py-4 rounded-full text-lg font-semibold transition ${t.btnSecondary}`}>
              See How
            </a>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className={`text-3xl md:text-4xl font-bold text-center mb-4 ${t.textPrimary}`}>Everything you need</h2>
          <p className={`text-center ${t.textSecondary} mb-16 max-w-lg mx-auto`}>One tool to create, schedule, and grow across every platform.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: '🎬', title: 'Studio', desc: 'Batch-create slideshows and videos with templates, audio banks, and text overlays. Generate dozens of posts in minutes.' },
              { icon: '📅', title: 'Scheduler', desc: 'Schedule across TikTok, Instagram, YouTube, and Facebook. Set cadence, shuffle order, and batch-assign accounts.' },
              { icon: '📊', title: 'Analytics', desc: 'Cross-platform performance tracking. See which content drives growth and optimize your strategy with data.' }
            ].map((f, i) => (
              <div key={i} className={`p-8 rounded-2xl border ${t.cardBorder} ${t.cardBg} transition hover:scale-[1.02]`}>
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className={`text-lg font-semibold mb-2 ${t.textPrimary}`}>{f.title}</h3>
                <p className={`${t.textSecondary} text-sm leading-relaxed`}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className={`py-24 px-6 ${t.bgSurface}`}>
        <div className="max-w-4xl mx-auto">
          <h2 className={`text-3xl md:text-4xl font-bold text-center mb-16 ${t.textPrimary}`}>How it works</h2>
          <div className="space-y-12">
            {[
              { num: '01', title: 'Connect your pages', desc: 'Link your TikTok, Instagram, YouTube, and Facebook accounts in seconds.' },
              { num: '02', title: 'Create content', desc: 'Use the studio to batch-generate slideshows and videos with your audio, images, and templates.' },
              { num: '03', title: 'Schedule & grow', desc: 'Set your cadence, assign to accounts, and let the scheduler handle the rest. Track everything in analytics.' }
            ].map((step, i) => (
              <div key={i} className="flex gap-6 items-start">
                <span className={`text-4xl font-bold ${t.textMuted} shrink-0 w-12`}>{step.num}</span>
                <div>
                  <h3 className={`text-xl font-semibold mb-2 ${t.textPrimary}`}>{step.title}</h3>
                  <p className={`${t.textSecondary} leading-relaxed`}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING ═══ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className={`text-3xl md:text-4xl font-bold text-center mb-4 ${t.textPrimary}`}>Simple pricing</h2>
          <p className={`text-center ${t.textSecondary} mb-16`}>Start free. Scale when you're ready.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { name: 'Starter', price: 'Free', desc: 'Get started with the basics', features: ['1 connected account', '30 scheduled posts/mo', 'Basic analytics', 'Studio access'] },
              { name: 'Pro', price: '$29', desc: 'For serious creators', features: ['5 connected accounts', 'Unlimited scheduled posts', 'Full analytics', 'Batch scheduling', '1 team member'], popular: true },
              { name: 'Team', price: '$79', desc: 'For managers & agencies', features: ['Unlimited accounts', 'Unlimited posts', 'Advanced analytics', 'Priority support', '5 team members'] }
            ].map((tier, i) => (
              <div key={i} className={`p-8 rounded-2xl border ${tier.popular ? 'border-indigo-500' : t.cardBorder} ${t.cardBg} relative`}>
                {tier.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-full">
                    Popular
                  </span>
                )}
                <h3 className={`text-lg font-semibold ${t.textPrimary}`}>{tier.name}</h3>
                <p className={`text-sm ${t.textSecondary} mb-4`}>{tier.desc}</p>
                <div className="mb-6">
                  <span className={`text-4xl font-bold ${t.textPrimary}`}>{tier.price}</span>
                  {tier.price !== 'Free' && <span className={`${t.textMuted}`}>/mo</span>}
                </div>
                <ul className="space-y-2 mb-8">
                  {tier.features.map((f, j) => (
                    <li key={j} className={`text-sm ${t.textSecondary} flex items-center gap-2`}>
                      <span className={`${t.accentText}`}>✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => { setAuthMode('signup'); setShowAuth(true); }}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition ${tier.popular ? t.btnPrimary : t.btnSecondary}`}
                >
                  Get Started
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER CTA ═══ */}
      <section className={`py-20 px-6 ${t.bgSurface} text-center`}>
        <h2 className={`text-3xl md:text-4xl font-bold mb-4 ${t.textPrimary}`}>Ready to create?</h2>
        <p className={`${t.textSecondary} mb-8 max-w-md mx-auto`}>Join creators who are scaling their content with StickToMusic.</p>
        <button onClick={() => { setAuthMode('signup'); setShowAuth(true); }} className={`px-8 py-4 rounded-full text-lg font-semibold transition ${t.btnPrimary}`}>
          Start Free →
        </button>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className={`py-8 px-6 border-t ${t.border} text-center`}>
        <p className={`text-sm ${t.textMuted}`}>© 2026 StickToMusic. All rights reserved.</p>
      </footer>

      {/* ═══ AUTH MODAL ═══ */}
      {showAuth && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuth(false); }}
        >
          <div className={`w-full max-w-md mx-4 p-8 rounded-2xl border ${t.cardBorder}`} style={{ backgroundColor: theme.bg.surface }}>
            <div className="flex justify-between items-center mb-6">
              <h2 className={`text-xl font-bold ${t.textPrimary}`}>
                {authMode === 'login' ? 'Welcome back' : 'Create your account'}
              </h2>
              <button onClick={() => setShowAuth(false)} className={`${t.textMuted} ${t.hoverText} text-xl`}>×</button>
            </div>

            {authError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {authError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {authMode === 'signup' && (
                <input
                  type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border ${t.inputBorder} ${t.inputFocus} outline-none text-sm transition`}
                  style={{ backgroundColor: theme.bg.input, color: theme.text.primary }}
                />
              )}
              <input
                type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className={`w-full px-4 py-3 rounded-xl border ${t.inputBorder} ${t.inputFocus} outline-none text-sm transition`}
                style={{ backgroundColor: theme.bg.input, color: theme.text.primary }}
              />
              <input
                type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className={`w-full px-4 py-3 rounded-xl border ${t.inputBorder} ${t.inputFocus} outline-none text-sm transition`}
                style={{ backgroundColor: theme.bg.input, color: theme.text.primary }}
              />
              <button
                type="submit" disabled={authLoading}
                className={`w-full py-3 rounded-xl text-sm font-semibold transition ${t.btnPrimary} disabled:opacity-50`}
              >
                {authLoading ? 'Loading...' : authMode === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            </form>

            <div className="my-4 flex items-center gap-3">
              <div className={`flex-1 h-px ${t.bgElevated}`} />
              <span className={`text-xs ${t.textMuted}`}>or</span>
              <div className={`flex-1 h-px ${t.bgElevated}`} />
            </div>

            <button
              onClick={onGoogleAuth}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition ${t.btnSecondary} flex items-center justify-center gap-2`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continue with Google
            </button>

            <p className={`text-center text-sm mt-4 ${t.textSecondary}`}>
              {authMode === 'login' ? "Don't have an account?" : 'Already have an account?'}
              <button
                onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                className={`ml-1 font-semibold ${t.accentText} ${t.hoverText}`}
              >
                {authMode === 'login' ? 'Sign up' : 'Log in'}
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
