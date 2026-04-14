import { FeatherArrowLeft } from '@subframe/core';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/components/Button';

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-12">
        {/* Back button */}
        <Button
          variant="neutral-tertiary"
          size="medium"
          icon={<FeatherArrowLeft />}
          onClick={() => navigate('/')}
        >
          Back to Home
        </Button>

        {/* Title */}
        <h1 className="text-4xl font-bold text-white mt-8 mb-2">Terms of Service</h1>
        <p className="text-neutral-500 mb-10">Last updated: February 23, 2026</p>

        {/* Introduction */}
        <p className="text-neutral-300 leading-relaxed mb-4">
          Welcome to StickToMusic. These Terms of Service ("Terms") govern your access to and use of
          the StickToMusic platform, website, and services (collectively, the "Service") operated by
          StickToMusic ("STM", "we", "us", or "our"). By accessing or using the Service, you agree
          to be bound by these Terms. If you do not agree, do not use the Service.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic is a content creation engine designed for music artists, labels, and their
          teams. We help you create videos and slideshows from your music and visual assets,
          schedule posts across social media platforms, and track performance analytics — all from
          one studio.
        </p>

        {/* 1. Acceptance of Terms */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">1. Acceptance of Terms</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          By creating an account, accessing the Service, or clicking "I Agree" (or similar
          affirmation), you confirm that you are at least 18 years of age (or the age of legal
          majority in your jurisdiction) and that you have the legal authority to enter into these
          Terms. If you are using the Service on behalf of an organization, you represent and
          warrant that you have the authority to bind that organization to these Terms.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Your continued use of the Service after any modifications to these Terms constitutes
          acceptance of the revised Terms. We encourage you to review this page periodically.
        </p>

        {/* 2. Description of Service */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">2. Description of Service</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic provides a suite of tools for music content creators, including but not
          limited to:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Video and Slideshow Creation</strong> — Upload your
            music, photos, and video clips. Our studio generates content optimized for social media
            platforms.
          </li>
          <li>
            <strong className="text-white">Social Media Scheduling</strong> — Connect your TikTok,
            Instagram, YouTube, and Facebook accounts. Schedule and publish content directly from
            StickToMusic.
          </li>
          <li>
            <strong className="text-white">Analytics Dashboard</strong> — Track post performance,
            engagement metrics, and audience growth across connected platforms.
          </li>
          <li>
            <strong className="text-white">Media Library</strong> — Organize your assets into
            collections and slide banks for efficient content production.
          </li>
          <li>
            <strong className="text-white">Multi-Artist Management</strong> — Manage content for
            multiple artists from a single account with role-based access controls.
          </li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          The Service may evolve over time. We reserve the right to modify, suspend, or discontinue
          any feature or aspect of the Service at any time, with or without notice.
        </p>

        {/* 3. Account Registration */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">3. Account Registration</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          To use the Service, you must create an account using Google Sign-In or an email and
          password through our authentication provider (Firebase Auth). You agree to:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Provide accurate, current, and complete information during registration.</li>
          <li>Maintain the security and confidentiality of your login credentials.</li>
          <li>Notify us immediately of any unauthorized access to or use of your account.</li>
          <li>Accept responsibility for all activity that occurs under your account.</li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You may not share your account credentials, create multiple accounts to circumvent
          restrictions, or use another person's account without permission. We reserve the right to
          suspend or terminate accounts that violate these requirements.
        </p>

        {/* 4. Subscription and Payment */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">4. Subscription and Payment</h2>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">4.1 Pricing Model</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic operates on a subscription basis, priced per "Social Set." One Social Set
          includes the ability to connect and manage one account each on Facebook, TikTok, Twitter
          (X), and Instagram. You may purchase additional Social Sets to manage more accounts or
          artists. Current pricing is available on our website at{' '}
          <a
            href="https://sticktomusic.com"
            className="text-brand-400 underline hover:text-brand-300"
            target="_blank"
            rel="noopener noreferrer"
          >
            sticktomusic.com
          </a>
          .
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">4.2 Billing</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          All payments are processed securely through Stripe. By subscribing, you authorize us to
          charge your payment method on a recurring basis (monthly or annually, as selected) until
          you cancel. Subscription fees are billed in advance at the beginning of each billing
          cycle.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">4.3 Free Trials</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We may offer free trial periods at our discretion. At the end of a trial, your
          subscription will automatically convert to a paid plan unless you cancel before the trial
          expires. We will notify you before any charges are applied.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">4.4 Refund Policy</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Subscription fees are generally non-refundable. However, if you experience a significant
          service disruption or billing error, you may contact us at{' '}
          <a
            href="mailto:support@sticktomusic.com"
            className="text-brand-400 underline hover:text-brand-300"
          >
            support@sticktomusic.com
          </a>{' '}
          to request a review. Refund requests are evaluated on a case-by-case basis. If you cancel
          your subscription, you will retain access to the Service through the end of your current
          billing period.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">4.5 Price Changes</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We reserve the right to change our subscription pricing. Any price changes will take
          effect at the start of your next billing cycle. We will provide at least 30 days' notice
          of any price increase via email or in-app notification.
        </p>

        {/* 5. User Content and Intellectual Property */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          5. User Content and Intellectual Property
        </h2>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">5.1 Your Content</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You retain full ownership of all content you upload, create, or submit through the Service
          ("User Content"), including but not limited to music tracks, photographs, video clips,
          artwork, lyrics, captions, and hashtags. StickToMusic does not claim any ownership rights
          over your User Content.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">5.2 License Grant to STM</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          By uploading User Content to the Service, you grant StickToMusic a limited, non-exclusive,
          worldwide, royalty-free license to store, process, display, reproduce, and distribute your
          User Content solely for the purpose of operating and providing the Service to you. This
          includes:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Storing your media files on our cloud infrastructure (Google Cloud/Firebase).</li>
          <li>
            Processing your content to generate videos, slideshows, and other derivative media as
            directed by you.
          </li>
          <li>
            Publishing your content to connected social media platforms on your behalf and at your
            direction.
          </li>
          <li>Displaying thumbnails and previews of your content within the Service interface.</li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          This license terminates when you delete your User Content from the Service or when your
          account is terminated, except where copies are retained in routine backups for a
          reasonable period.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">5.3 Content Representations</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You represent and warrant that you own or have the necessary rights, licenses, and
          permissions to all User Content you upload, and that your User Content does not infringe
          on the intellectual property rights, privacy rights, or any other rights of any third
          party. You are solely responsible for ensuring that your use of music, images, and other
          media complies with applicable copyright and licensing requirements.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">5.4 STM Intellectual Property</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          The Service, including its design, code, features, templates, and branding, is owned by
          StickToMusic and is protected by copyright, trademark, and other intellectual property
          laws. These Terms do not grant you any right to use the StickToMusic name, logo, or
          trademarks without our prior written consent.
        </p>

        {/* 6. Social Media Integration */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">6. Social Media Integration</h2>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">6.1 Account Authorization</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          The Service allows you to connect third-party social media accounts (including TikTok,
          Instagram, YouTube, Facebook, and Twitter/X). By connecting these accounts, you authorize
          StickToMusic to access and interact with those platforms on your behalf, including posting
          content, retrieving analytics data, and managing scheduled posts.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">6.2 Platform Compliance</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You are solely responsible for ensuring that your use of the Service complies with the
          terms of service, community guidelines, and policies of each connected social media
          platform. StickToMusic is not responsible for any consequences arising from content posted
          to your social media accounts through the Service, including account suspensions, content
          removals, or policy violations imposed by third-party platforms.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">6.3 Third-Party Services</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Social media posting and scheduling is facilitated through third-party APIs. We do not
          guarantee uninterrupted access to any third-party platform. Changes to third-party APIs,
          rate limits, or terms of service may affect the availability or functionality of social
          media features within StickToMusic.
        </p>

        {/* 7. Acceptable Use */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">7. Acceptable Use</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You agree not to use the Service to:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            Upload, create, or distribute content that is illegal, harmful, threatening, abusive,
            harassing, defamatory, obscene, or otherwise objectionable.
          </li>
          <li>
            Infringe on the intellectual property rights of any third party, including uploading
            music, images, or videos you do not have the right to use.
          </li>
          <li>
            Engage in spamming, including mass-posting identical or near-identical content across
            platforms in a manner that violates platform policies.
          </li>
          <li>
            Attempt to gain unauthorized access to the Service, other user accounts, or any systems
            or networks connected to the Service.
          </li>
          <li>
            Reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code
            of the Service or any part thereof.
          </li>
          <li>Use the Service to distribute malware, viruses, or any other malicious code.</li>
          <li>
            Use automated scripts, bots, or scrapers to access the Service except through our
            official APIs.
          </li>
          <li>
            Resell, sublicense, or commercially exploit the Service without our prior written
            consent.
          </li>
          <li>Interfere with or disrupt the integrity or performance of the Service.</li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We reserve the right to investigate and take appropriate action against anyone who, in our
          sole discretion, violates this section, including removing content, suspending accounts,
          and reporting violations to law enforcement.
        </p>

        {/* 8. Privacy */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">8. Privacy</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Your privacy is important to us. Our collection, use, and disclosure of personal
          information is governed by our{' '}
          <a href="/privacy" className="text-brand-400 underline hover:text-brand-300">
            Privacy Policy
          </a>
          , which is incorporated into these Terms by reference. By using the Service, you consent
          to the collection and use of your information as described in the Privacy Policy.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          In summary, we collect account information (name, email), usage data, and the content you
          upload. Your data is stored on Firebase (Google Cloud) infrastructure. We do not sell your
          personal information to third parties. We use your data only to provide and improve the
          Service.
        </p>

        {/* 9. Termination */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">9. Termination</h2>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">9.1 Termination by You</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You may cancel your subscription and terminate your account at any time through the
          Settings page or by contacting us at{' '}
          <a
            href="mailto:support@sticktomusic.com"
            className="text-brand-400 underline hover:text-brand-300"
          >
            support@sticktomusic.com
          </a>
          . Upon cancellation, your subscription will remain active through the end of your current
          billing period. After that, your access to paid features will be revoked.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">9.2 Termination by STM</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We reserve the right to suspend or terminate your account, with or without notice, if we
          reasonably believe that you have violated these Terms, engaged in fraudulent or illegal
          activity, or if your use of the Service poses a risk to other users or to the integrity of
          the platform. In cases of severe violations, termination may be immediate and without
          refund.
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">9.3 Effect of Termination</h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Upon termination, your right to access the Service ceases immediately (or at the end of
          your billing period for voluntary cancellations). We may delete your account data,
          including uploaded media and generated content, after a reasonable retention period of 30
          days. We recommend that you export or download any content you wish to retain before
          terminating your account.
        </p>

        {/* 10. Disclaimers */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">10. Disclaimers</h2>
        <p className="text-neutral-300 leading-relaxed mb-4 uppercase font-medium">
          The Service is provided on an "as is" and "as available" basis, without warranties of any
          kind, either express or implied, including but not limited to implied warranties of
          merchantability, fitness for a particular purpose, and non-infringement.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Without limiting the foregoing, StickToMusic does not warrant that:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>The Service will be uninterrupted, timely, secure, or error-free.</li>
          <li>The results obtained from the use of the Service will be accurate or reliable.</li>
          <li>
            Any content you create or post through the Service will achieve any particular level of
            engagement, reach, or performance on social media platforms.
          </li>
          <li>
            Third-party platforms (TikTok, Instagram, YouTube, Facebook, Twitter/X) will continue to
            operate as expected or maintain compatibility with our Service.
          </li>
          <li>
            Scheduled posts will be published at the exact requested time, as publishing depends on
            third-party API availability.
          </li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You acknowledge that social media platforms may change their APIs, terms of service, or
          features at any time, and that such changes may affect the functionality of StickToMusic.
          We are not responsible for any loss or damage resulting from such changes.
        </p>

        {/* 11. Limitation of Liability */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">11. Limitation of Liability</h2>
        <p className="text-neutral-300 leading-relaxed mb-4 uppercase font-medium">
          To the maximum extent permitted by applicable law, in no event shall StickToMusic, its
          officers, directors, employees, agents, or affiliates be liable for any indirect,
          incidental, special, consequential, or punitive damages, including but not limited to loss
          of profits, data, use, goodwill, or other intangible losses, arising out of or in
          connection with your use of or inability to use the Service.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          In no event shall StickToMusic's total aggregate liability to you for all claims arising
          out of or related to these Terms or the Service exceed the amount you have paid to
          StickToMusic in the twelve (12) months immediately preceding the event giving rise to the
          claim, or one hundred dollars ($100), whichever is greater.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Some jurisdictions do not allow the exclusion or limitation of certain damages. In such
          jurisdictions, our liability shall be limited to the greatest extent permitted by law.
        </p>

        {/* 12. Changes to Terms */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">12. Changes to Terms</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We may update these Terms from time to time to reflect changes in our practices, features,
          or legal requirements. When we make material changes, we will:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Update the "Last updated" date at the top of this page.</li>
          <li>
            Notify you via email or through a prominent notice within the Service at least 14 days
            before the changes take effect.
          </li>
          <li>
            Provide you with the opportunity to review the revised Terms before they become binding.
          </li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Your continued use of the Service after the effective date of any revised Terms
          constitutes your acceptance of those changes. If you do not agree with the revised Terms,
          you must stop using the Service and cancel your account.
        </p>

        {/* 13. Contact Information */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">13. Contact Information</h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          If you have any questions, concerns, or feedback about these Terms or the Service, please
          contact us:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Email:</strong>{' '}
            <a
              href="mailto:support@sticktomusic.com"
              className="text-brand-400 underline hover:text-brand-300"
            >
              support@sticktomusic.com
            </a>
          </li>
          <li>
            <strong className="text-white">Website:</strong>{' '}
            <a
              href="https://sticktomusic.com"
              className="text-brand-400 underline hover:text-brand-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              sticktomusic.com
            </a>
          </li>
        </ul>

        {/* Closing */}
        <div className="border-t border-neutral-200 mt-12 pt-8">
          <p className="text-neutral-500 text-sm leading-relaxed">
            These Terms of Service constitute the entire agreement between you and StickToMusic
            regarding your use of the Service and supersede any prior agreements. If any provision
            of these Terms is found to be unenforceable, the remaining provisions will remain in
            full force and effect. Our failure to enforce any right or provision of these Terms
            shall not be considered a waiver of that right or provision.
          </p>
          <p className="text-neutral-500 text-sm leading-relaxed mt-4">
            These Terms shall be governed by and construed in accordance with the laws of the United
            States, without regard to conflict of law principles. Any disputes arising from these
            Terms or the Service shall be resolved through binding arbitration in accordance with
            the rules of the American Arbitration Association.
          </p>
        </div>

        {/* Bottom back button */}
        <div className="mt-10">
          <Button
            variant="neutral-tertiary"
            size="medium"
            icon={<FeatherArrowLeft />}
            onClick={() => navigate('/')}
          >
            Back to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
