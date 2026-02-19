import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from '../ui/components/Button';
import { getTierForSets } from '../services/subscriptionService';

/**
 * OnboardingWizard — First-run modal wizard, role-specific.
 * Marks onboardingComplete in Firestore on finish.
 */
const OnboardingWizard = ({ user, socialSetsAllowed = 0, onComplete }) => {
  const { theme } = useTheme();
  const t = theme.tw;
  const [step, setStep] = useState(0);

  const role = user?.role || 'artist';
  const tierInfo = getTierForSets(socialSetsAllowed);

  const STEPS = {
    artist: [
      {
        title: 'Welcome to StickToMusic!',
        description: `You have ${socialSetsAllowed || 0} Social Sets on the ${tierInfo.name} plan. Each Social Set lets you connect 4 platform accounts (Facebook, TikTok, Twitter, Instagram).`,
      },
      {
        title: 'Your Dashboard',
        description: 'Your dashboard shows connected accounts, upcoming posts, and plan usage at a glance. Check the Schedule tab to see your posting calendar.',
      },
      {
        title: 'Connect Your Accounts',
        description: 'Head to your dashboard to link your first Social Set — connect Facebook, TikTok, Twitter, and Instagram accounts to start posting.',
      },
      {
        title: "You're all set!",
        description: 'Explore your dashboard, check your schedule, and track performance in analytics. Your operator will handle content creation and scheduling.',
      },
    ],
    operator: [
      {
        title: 'Welcome, Operator!',
        description: `You have ${socialSetsAllowed || 0} Social Sets to allocate across your artists. Each set bundles 4 platform slots.`,
      },
      {
        title: 'Add Your First Artist',
        description: 'Go to the Artists tab to add an artist. You can set their name, allocate Social Sets, and optionally invite them via email.',
      },
      {
        title: 'Studio & Scheduler',
        description: 'Use the Studio to batch-create content, then schedule across platforms in the Schedule tab. Pages shows all connected accounts.',
      },
      {
        title: 'Ready to go!',
        description: 'Start by adding an artist in the Artists tab. Create content, schedule posts, and track everything from your dashboard.',
      },
    ],
    collaborator: [
      {
        title: 'Welcome!',
        description: `You've been invited as a collaborator by ${user?.invitedBy || 'an artist'}. You can view the dashboard and schedule.`,
      },
      {
        title: "Here's what you can see",
        description: 'Your Dashboard shows stats and upcoming posts. The Schedule tab shows the posting calendar. Analytics tracks performance.',
      },
      {
        title: "You're ready!",
        description: 'Explore the dashboard to see how things are going. Everything is view-only — your artist or operator manages content and scheduling.',
      },
    ],
    conductor: [
      {
        title: 'Conductor Access',
        description: 'You have full access to all features and all artists. No restrictions.',
      },
    ],
  };

  const steps = STEPS[role] || STEPS.artist;
  const currentStep = steps[step] || steps[0];
  const isLast = step >= steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div className={`w-full max-w-md mx-4 p-8 rounded-2xl border ${t.cardBorder}`}
        style={{ backgroundColor: theme.bg.surface }}>
        <div className="text-center mb-6">
          <h2 className={`text-xl font-bold ${t.textPrimary} mb-2`}>{currentStep.title}</h2>
          <p className={`${t.textSecondary} text-sm leading-relaxed`}>{currentStep.description}</p>
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition ${
                i === step ? 'bg-indigo-500' : 'opacity-30'
              }`}
              style={{ backgroundColor: i === step ? theme.accent.primary : theme.text.muted }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="neutral-tertiary" onClick={onComplete}>Skip</Button>
          {isLast ? (
            <Button variant="brand-primary" onClick={onComplete}>Get Started</Button>
          ) : (
            <Button variant="brand-primary" onClick={() => setStep(s => s + 1)}>Next</Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
