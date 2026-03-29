import React, { useState } from 'react';

const faqs = [
  {
    q: 'How is this different from paying for views?',
    a: 'Services that blast your song through random accounts are buying you numbers, not fans. We build ecosystems\u2014pages with real audiences who engage because the content fits their taste.',
  },
  {
    q: 'Will I see which accounts are posting my music?',
    a: "We keep our methodology under the hood. You'll get aggregate performance data and monthly reports, but the world pages operate independently. This is what makes them feel organic.",
  },
  {
    q: 'How long until I see results?',
    a: 'World pages compound over time. Most artists start seeing traction in 4-6 weeks, with significant growth by month 3.',
  },
  {
    q: 'What do I need to provide?',
    a: 'Your music, any existing visual assets, and 15 minutes to fill out our intake form. We handle everything else.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. No long-term contracts. We earn your business every month.',
  },
];

const tiers = [
  {
    name: 'Starter',
    pages: 5,
    price: 800,
    description: 'Testing the waters',
    detail: 'Perfect for indie artists or anyone wanting to test the world page approach.',
    features: [
      '5 world pages',
      'TikTok, Instagram, Facebook, YouTube',
      'Monthly performance report',
    ],
  },
  {
    name: 'Standard',
    pages: 15,
    price: 1500,
    description: 'Ready to scale',
    detail:
      'For artists serious about building cultural presence. Enough coverage to hit multiple niches simultaneously.',
    features: [
      '15 world pages',
      'TikTok, Instagram, Facebook, YouTube',
      'Monthly performance report',
    ],
  },
  {
    name: 'Scale',
    pages: 30,
    price: 2500,
    description: 'Full scale',
    detail:
      'Album rollouts, tour promotion, or artists who want comprehensive coverage. Serious infrastructure.',
    features: [
      '30 world pages',
      'TikTok, Instagram, Facebook, YouTube',
      'Monthly performance report',
    ],
  },
  {
    name: 'Sensation',
    pages: 50,
    price: 3500,
    description: 'Maximum coverage',
    detail:
      'The full ecosystem. 50 world pages means your music is everywhere your target fans spend time.',
    features: [
      '50 world pages',
      'TikTok, Instagram, Facebook, YouTube',
      'Monthly performance report',
    ],
  },
];

const cdTiers = [
  {
    name: 'CD Lite',
    price: 2500,
    description: 'Content partnership',
    features: ['Main account content creation', 'Content strategy & planning'],
  },
  {
    name: 'CD Standard',
    price: 5000,
    description: 'Full creative direction',
    features: [
      'Everything in CD Lite',
      'Rollout planning & content calendar',
      'Visual direction & mood boards',
      'Asset briefs (covers, visuals, videos)',
      'Social content templates',
      'Analytics & performance insights',
    ],
  },
];

export function LegacyMarketingPages({
  currentPage,
  setCurrentPage,
  goToIntake,
  user,
  showPrivateModeWarning,
}) {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Private mode warning modal */}
      {showPrivateModeWarning && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[10000]">
          <div className="bg-[#1a1a1a] p-8 rounded-xl max-w-[500px] text-center">
            <h2 className="text-2xl font-bold mb-4">Private Browsing Not Supported</h2>
            <p className="text-[#999] mb-6">
              StickToMusic requires localStorage to function properly. Please use normal browsing
              mode.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-violet-600 text-white px-6 py-3 rounded-lg border-none cursor-pointer font-semibold"
            >
              Reload Page
            </button>
          </div>
        </div>
      )}

      {/* Legacy marketing pages -- kept for reference, rarely reached */}

      {/* HOME */}
      {currentPage === 'home' && (
        <div className="min-h-screen flex flex-col justify-center items-center text-center px-6">
          <h1 className="text-5xl md:text-7xl font-bold max-w-4xl leading-tight mb-6">
            Your music deserves to live in culture.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-400 max-w-xl mb-12">
            World pages that seed your sound where fans actually discover music.
          </p>
          <div className="flex gap-4 flex-wrap justify-center">
            <button
              onClick={goToIntake}
              className="px-8 py-4 bg-white text-black rounded-full text-lg font-semibold hover:bg-zinc-200 transition"
            >
              Apply
            </button>
            <button
              onClick={() => setCurrentPage('how')}
              className="px-8 py-4 border border-zinc-600 rounded-full text-lg font-semibold hover:bg-zinc-900 transition"
            >
              How It Works
            </button>
          </div>
        </div>
      )}

      {/* HOW IT WORKS */}
      {currentPage === 'how' && (
        <div className="min-h-screen pt-28 pb-20 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="mb-16">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">How It Works</h1>
              <p className="text-xl text-zinc-400">The system behind organic music discovery.</p>
            </div>
            <section className="mb-20">
              <h2 className="text-lg font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                The Problem
              </h2>
              <div className="border-l-2 border-zinc-700 pl-8">
                <p className="text-2xl md:text-3xl font-semibold leading-relaxed mb-4">
                  The algorithm isn't broken. Your distribution is.
                </p>
                <p className="text-lg text-zinc-400 leading-relaxed">
                  Posting on your main account and hoping TikTok picks it up isn't a strategy. The
                  artists breaking through are showing up in the feeds of people who haven't heard
                  of them yet. That takes more than one page. It takes an ecosystem.
                </p>
              </div>
            </section>
            <section className="mb-20">
              <h2 className="text-lg font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                World Pages
              </h2>
              <div className="border-l-2 border-zinc-700 pl-8">
                <p className="text-2xl md:text-3xl font-semibold leading-relaxed mb-4">
                  Niche accounts that plant your music where fans already live.
                </p>
                <p className="text-lg text-zinc-400 leading-relaxed mb-8">
                  A world page is a niche aesthetic account--fashion edits, cinematic clips, mood
                  content--that builds its own audience. Your music gets seeded naturally.
                </p>
                <div className="grid md:grid-cols-3 gap-4">
                  {[
                    {
                      title: 'Organic Reach',
                      desc: 'Shows up in feeds without feeling like a promotion.',
                    },
                    {
                      title: 'Cultural Grafting',
                      desc: 'Your sound attached to visuals fans already love.',
                    },
                    { title: 'Compounding Growth', desc: 'The ecosystem expands with every post.' },
                  ].map((item, i) => (
                    <div key={i} className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
                      <h3 className="font-semibold mb-2">{item.title}</h3>
                      <p className="text-zinc-500 text-sm">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="mb-16">
              <h2 className="text-lg font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                The Process
              </h2>
              <div className="border-l-2 border-zinc-700 pl-8 space-y-8">
                {[
                  {
                    num: '01',
                    title: 'Intake',
                    desc: 'Tell us about your sound, aesthetic, and target audience.',
                  },
                  {
                    num: '02',
                    title: 'World Building',
                    desc: 'We identify and build niche pages aligned with your music.',
                  },
                  {
                    num: '03',
                    title: 'Content Seeding',
                    desc: 'Your music woven into content across TikTok, Instagram, Facebook, and YouTube.',
                  },
                  {
                    num: '04',
                    title: 'Growth',
                    desc: 'Watch your reach expand with monthly performance data.',
                  },
                ].map((step, i) => (
                  <div key={i} className="flex gap-6">
                    <span className="text-3xl font-bold text-zinc-700">{step.num}</span>
                    <div>
                      <h3 className="text-lg font-semibold mb-1">{step.title}</h3>
                      <p className="text-zinc-400">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <div className="text-center pt-8 border-t border-zinc-800">
              <button
                onClick={() => setCurrentPage('pricing')}
                className="px-8 py-4 bg-white text-black rounded-full text-lg font-semibold hover:bg-zinc-200 transition"
              >
                See Pricing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRICING */}
      {currentPage === 'pricing' && (
        <div className="min-h-screen pt-28 pb-20 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">Pricing</h1>
              <p className="text-xl text-zinc-400">
                World page packages and creative direction add-ons
              </p>
            </div>
            <div className="mb-12">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                Page Builder Tiers
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                {tiers.map((tier) => (
                  <div
                    key={tier.name}
                    className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50"
                  >
                    <div className="mb-3">
                      <h3 className="text-xl font-bold">{tier.name}</h3>
                      <p className="text-zinc-500 text-sm">{tier.description}</p>
                    </div>
                    <div className="mb-3">
                      <span className="text-3xl font-bold">${tier.price.toLocaleString()}</span>
                      <span className="text-zinc-500">/mo</span>
                    </div>
                    <div className="text-3xl font-bold text-zinc-600 mb-3">{tier.pages} pages</div>
                    <p className="text-sm text-zinc-500 mb-4">{tier.detail}</p>
                    <ul className="space-y-1">
                      {tier.features.map((f, i) => (
                        <li key={i} className="text-xs text-zinc-400">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <div className="mb-12">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                Creative Direction Add-Ons
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {cdTiers.map((cd) => (
                  <div
                    key={cd.name}
                    className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold">{cd.name}</h3>
                        <p className="text-zinc-500 text-sm">{cd.description}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold">+${cd.price.toLocaleString()}</span>
                        <span className="text-zinc-500">/mo</span>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {cd.features.map((f, i) => (
                        <li key={i} className="text-sm text-zinc-400 flex items-center gap-2">
                          <span className="text-green-400">&#10003;</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            {/* Feature Comparison Table */}
            <div className="mb-16 overflow-x-auto">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                Feature Comparison
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-4 px-4 text-zinc-400 font-medium">Feature</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Starter</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Standard</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Scale</th>
                    <th className="text-center py-4 px-2 text-zinc-400 font-medium">Sensation</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      feature: 'World Pages',
                      starter: '5',
                      standard: '15',
                      scale: '30',
                      sensation: '50',
                    },
                    {
                      feature: 'Posts per Week',
                      starter: '10',
                      standard: '30',
                      scale: '60',
                      sensation: '100+',
                    },
                    {
                      feature: 'Aesthetic Categories',
                      starter: '1',
                      standard: '2',
                      scale: '3',
                      sensation: 'All',
                    },
                    {
                      feature: 'Artist Dashboard',
                      starter: true,
                      standard: true,
                      scale: true,
                      sensation: true,
                    },
                    {
                      feature: 'Real-time Analytics',
                      starter: true,
                      standard: true,
                      scale: true,
                      sensation: true,
                    },
                    {
                      feature: 'Dedicated Manager',
                      starter: false,
                      standard: true,
                      scale: true,
                      sensation: true,
                    },
                    {
                      feature: 'Priority Support',
                      starter: false,
                      standard: false,
                      scale: true,
                      sensation: true,
                    },
                    {
                      feature: 'Custom Strategy Call',
                      starter: false,
                      standard: false,
                      scale: true,
                      sensation: true,
                    },
                    {
                      feature: 'Performance Reports',
                      starter: 'Monthly',
                      standard: 'Bi-weekly',
                      scale: 'Weekly',
                      sensation: 'Daily',
                    },
                    {
                      feature: 'Adjacent Artist Mix',
                      starter: '70/30',
                      standard: '70/30',
                      scale: '60/40',
                      sensation: 'Custom',
                    },
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-zinc-800/50">
                      <td className="py-3 px-4 text-zinc-300">{row.feature}</td>
                      {['starter', 'standard', 'scale', 'sensation'].map((tier) => (
                        <td key={tier} className="py-3 px-2 text-center">
                          {typeof row[tier] === 'boolean' ? (
                            row[tier] ? (
                              <span className="text-green-400">&#10003;</span>
                            ) : (
                              <span className="text-zinc-600">&mdash;</span>
                            )
                          ) : (
                            <span className="text-zinc-400">{row[tier]}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-center mb-16">
              <button
                onClick={goToIntake}
                className="px-8 py-4 bg-white text-black rounded-full text-lg font-semibold hover:bg-zinc-200 transition"
              >
                Apply Now
              </button>
              <p className="text-zinc-500 text-sm mt-3">
                You'll select your preferred tier in the application
              </p>
            </div>
            <div className="max-w-3xl mx-auto">
              <h2 className="text-xl font-bold mb-6 text-center">Questions</h2>
              <div className="space-y-2">
                {faqs.map((faq, i) => (
                  <div key={i} className="border border-zinc-800 rounded-xl overflow-hidden">
                    <button
                      className="w-full p-4 text-left flex justify-between items-center hover:bg-zinc-900 transition"
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    >
                      <span className="font-medium text-sm">{faq.q}</span>
                      <span className="text-zinc-500">{openFaq === i ? '\u2212' : '+'}</span>
                    </button>
                    {openFaq === i && (
                      <div className="px-4 pb-4 text-zinc-400 text-sm">{faq.a}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="py-8 px-6 border-t border-zinc-900">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <button
            onClick={() => {
              if (user) {
                setCurrentPage(user.role === 'artist' ? 'artist-portal' : 'operator');
              } else {
                setCurrentPage('home');
              }
            }}
            className="font-bold hover:text-zinc-300 transition cursor-pointer"
          >
            StickToMusic
          </button>
          <span className="text-zinc-600 text-sm">&copy; 2026</span>
        </div>
      </footer>
    </div>
  );
}
