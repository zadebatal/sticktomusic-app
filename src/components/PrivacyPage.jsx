import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/components/Button';
import { FeatherArrowLeft } from '@subframe/core';

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-12">
        {/* Back button */}
        <Button
          variant="neutral-tertiary"
          icon={<FeatherArrowLeft />}
          onClick={() => navigate('/')}
        >
          Back to Home
        </Button>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-bold text-white mt-8 mb-2">
          Privacy Policy
        </h1>
        <p className="text-neutral-400 mb-10">Last updated: February 23, 2026</p>

        {/* Intro */}
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic ("we," "us," or "our") operates the StickToMusic platform at
          sticktomusic.com (the "Service"), a music content creation and social media
          management tool for artists, labels, and music creators. This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information when
          you use our Service.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          By accessing or using StickToMusic, you agree to the collection and use of
          information in accordance with this Privacy Policy. If you do not agree with
          the terms of this Privacy Policy, please do not access the Service.
        </p>

        {/* 1. Information We Collect */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          1. Information We Collect
        </h2>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">
          Account Information
        </h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          When you create an account, we collect:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Name and display name</li>
          <li>Email address</li>
          <li>Password (hashed and stored securely by Firebase Authentication &mdash; we never store plaintext passwords)</li>
          <li>Google account information (if you sign in with Google), including your Google profile name, email, and profile photo</li>
          <li>Role and permissions within the platform (e.g., artist, operator, conductor)</li>
        </ul>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">
          Content and Media
        </h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          When you use our Service, you may upload or create:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Photos, images, and graphics (including HEIC and TIFF formats)</li>
          <li>Videos and video clips</li>
          <li>Audio files, music tracks, and voice recordings</li>
          <li>Slideshows, video projects, and other created content</li>
          <li>Text overlays, captions, hashtags, and lyric data</li>
          <li>Content collections and organizational structures (projects, niches, banks)</li>
        </ul>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">
          Social Media and Connected Accounts
        </h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          When you connect social media accounts for posting, we collect:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Social media account identifiers and authentication tokens for TikTok, Instagram, YouTube, and Facebook</li>
          <li>Posting schedules and scheduling preferences</li>
          <li>Post performance data and engagement metrics from connected platforms</li>
        </ul>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">
          Usage and Device Data
        </h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We automatically collect certain information when you use the Service:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Usage logs, including features accessed, actions taken, and timestamps</li>
          <li>Device information such as browser type, operating system, and screen resolution</li>
          <li>IP address and general location information</li>
          <li>Analytics data about how you interact with the Service</li>
          <li>Error logs and performance data to help us improve the Service</li>
        </ul>

        {/* 2. How We Use Your Information */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          2. How We Use Your Information
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We use the information we collect for the following purposes:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Service Delivery:</strong> To provide, operate, and maintain the StickToMusic platform, including account management, authentication, and access control
          </li>
          <li>
            <strong className="text-white">Content Processing:</strong> To process, store, and render your uploaded media and created content (slideshows, videos, photo montages) within the platform
          </li>
          <li>
            <strong className="text-white">Scheduling and Posting:</strong> To schedule and publish your content to connected social media platforms (TikTok, Instagram, YouTube, Facebook) via our posting services
          </li>
          <li>
            <strong className="text-white">Analytics:</strong> To provide you with analytics and insights about your content performance across connected platforms
          </li>
          <li>
            <strong className="text-white">Communication:</strong> To send you service-related notifications, updates, security alerts, and support messages
          </li>
          <li>
            <strong className="text-white">Improvement:</strong> To analyze usage patterns and improve the functionality, performance, and user experience of our Service
          </li>
          <li>
            <strong className="text-white">Payment Processing:</strong> To process subscription payments and manage billing through our payment provider
          </li>
          <li>
            <strong className="text-white">Security:</strong> To detect, prevent, and address fraud, abuse, security issues, and technical problems
          </li>
        </ul>

        {/* 3. Information Sharing */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          3. Information Sharing
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          <strong className="text-white">We do not sell your personal information to third parties.</strong> We
          share your information only in the following circumstances:
        </p>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">
          Third-Party Service Providers
        </h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We use the following third-party services to operate StickToMusic. Each
          provider receives only the data necessary to perform its function:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Firebase / Google Cloud:</strong> Authentication (email/password and Google Sign-In), Firestore database for storing your account data and content metadata, and Cloud Storage for uploaded media files
          </li>
          <li>
            <strong className="text-white">Stripe:</strong> Payment processing for subscriptions. Stripe processes your payment card information directly &mdash; StickToMusic does not store, access, or transmit your credit card numbers. Stripe's handling of your payment data is governed by the{' '}
            <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              Stripe Privacy Policy
            </a>
          </li>
          <li>
            <strong className="text-white">Late.co:</strong> Social media posting API used to publish your scheduled content to connected platforms. Late.co receives your content and posting instructions when you schedule or publish posts
          </li>
          <li>
            <strong className="text-white">TikTok, Instagram, YouTube, Facebook:</strong> When you connect these platforms, your content and associated metadata (captions, hashtags, scheduling data) are transmitted to these services for publishing. Each platform's use of your data is governed by its own privacy policy
          </li>
        </ul>

        <h3 className="text-lg font-medium text-white mt-6 mb-3">
          Other Disclosures
        </h3>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We may also disclose your information if required to do so by law, in response
          to valid legal process (such as a subpoena or court order), to protect the
          rights, property, or safety of StickToMusic, our users, or the public, or in
          connection with a merger, acquisition, or sale of assets (in which case you
          would be notified).
        </p>

        {/* 4. Data Storage and Security */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          4. Data Storage and Security
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Your data is stored on Google Cloud infrastructure located in the United
          States, managed through Firebase services. We implement the following
          security measures to protect your information:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>All data is encrypted in transit using TLS/SSL (HTTPS)</li>
          <li>Data at rest is encrypted using Google Cloud's default encryption</li>
          <li>Passwords are hashed by Firebase Authentication and never stored in plaintext</li>
          <li>Firestore security rules enforce per-user and per-artist data isolation</li>
          <li>Authentication tokens are managed securely by Firebase Auth with automatic expiration and refresh</li>
          <li>Payment data is handled exclusively by Stripe's PCI-compliant infrastructure</li>
          <li>Role-based access control limits data access within the platform (artist, operator, conductor roles)</li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          While we strive to use commercially acceptable means to protect your personal
          information, no method of electronic transmission or storage is 100% secure.
          We cannot guarantee absolute security, but we continuously work to improve our
          security practices.
        </p>

        {/* 5. Cookies and Local Storage */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          5. Cookies and Local Storage
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic uses cookies and browser local storage for the following
          purposes:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Session Management:</strong> Firebase Authentication cookies maintain your login session so you stay signed in across visits
          </li>
          <li>
            <strong className="text-white">Application State:</strong> We use browser localStorage to cache your app preferences, theme selection, editor state, and recently accessed data for faster loading and offline resilience
          </li>
          <li>
            <strong className="text-white">Artist Data Isolation:</strong> localStorage is namespaced per artist to ensure data separation across artist profiles
          </li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          <strong className="text-white">We do not use third-party tracking cookies.</strong> We do not
          serve ads and do not use cookies for advertising or cross-site tracking
          purposes. The cookies and local storage we use are strictly necessary for the
          operation of the Service.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          You can clear your browser's cookies and localStorage at any time through your
          browser settings. Note that clearing this data will sign you out and reset
          your local preferences.
        </p>

        {/* 6. Your Rights */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          6. Your Rights
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          Depending on your location, you may have the following rights regarding your
          personal information:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Access:</strong> You can request a copy of the personal information we hold about you, including your account data, uploaded content, and usage records
          </li>
          <li>
            <strong className="text-white">Correction:</strong> You can update or correct your account information at any time through the Settings page, or contact us for assistance with other corrections
          </li>
          <li>
            <strong className="text-white">Deletion:</strong> You can request deletion of your account and all associated data. Upon request, we will delete your personal data and content within 30 days, subject to the retention periods described in Section 7
          </li>
          <li>
            <strong className="text-white">Data Export:</strong> You can request an export of your personal data in a commonly used, machine-readable format
          </li>
          <li>
            <strong className="text-white">Opt-Out of Communications:</strong> You can opt out of non-essential email communications at any time. Service-related notifications (such as security alerts and billing notices) cannot be opted out of while your account is active
          </li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          To exercise any of these rights, please contact us at{' '}
          <a href="mailto:privacy@sticktomusic.com" className="text-blue-400 hover:text-blue-300 underline">
            privacy@sticktomusic.com
          </a>
          . We will respond to your request within 30 days.
        </p>

        {/* 7. Data Retention */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          7. Data Retention
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We retain your information according to the following schedule:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Active Accounts:</strong> Your account data, uploaded content, created projects, and scheduling data are retained for as long as your account remains active
          </li>
          <li>
            <strong className="text-white">Account Deletion:</strong> Upon account deletion or a verified deletion request, your personal data and user-generated content will be permanently deleted within 30 days
          </li>
          <li>
            <strong className="text-white">Backups:</strong> Your data may persist in encrypted backup systems for up to 90 days after deletion, after which it is permanently purged
          </li>
          <li>
            <strong className="text-white">Analytics Data:</strong> Aggregated, anonymized analytics data (which cannot be used to identify you) may be retained indefinitely for the purpose of improving our Service
          </li>
          <li>
            <strong className="text-white">Legal Obligations:</strong> We may retain certain information as necessary to comply with legal obligations, resolve disputes, or enforce our agreements
          </li>
        </ul>

        {/* 8. Children's Privacy */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          8. Children's Privacy
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic is not intended for use by anyone under the age of 13. We do not
          knowingly collect personal information from children under 13 years of age, in
          compliance with the Children's Online Privacy Protection Act (COPPA).
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          If we discover that we have collected personal information from a child under
          13 without verified parental consent, we will take immediate steps to delete
          that information. If you believe that a child under 13 has provided us with
          personal information, please contact us at{' '}
          <a href="mailto:privacy@sticktomusic.com" className="text-blue-400 hover:text-blue-300 underline">
            privacy@sticktomusic.com
          </a>
          .
        </p>

        {/* 9. International Data Transfers */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          9. International Data Transfers
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          StickToMusic is operated from and data is processed in the United States using
          Google Cloud infrastructure. If you access the Service from outside the United
          States, please be aware that your information will be transferred to, stored,
          and processed in the United States.
        </p>
        <p className="text-neutral-300 leading-relaxed mb-4">
          By using the Service, you consent to the transfer of your information to the
          United States and acknowledge that data protection laws in the United States
          may differ from those in your country of residence. We take reasonable steps
          to ensure that your data is treated securely and in accordance with this
          Privacy Policy regardless of where it is processed.
        </p>

        {/* 10. Changes to This Policy */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          10. Changes to This Policy
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We may update this Privacy Policy from time to time to reflect changes in our
          practices, technology, legal requirements, or other factors. When we make
          material changes, we will notify you by:
        </p>
        <ul className="list-disc pl-6 text-neutral-300 space-y-2 mb-4">
          <li>Sending a notification to the email address associated with your account</li>
          <li>Displaying a prominent notice within the Service (in-app notification)</li>
          <li>Updating the "Last updated" date at the top of this page</li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We encourage you to review this Privacy Policy periodically. Your continued
          use of the Service after any changes constitutes your acceptance of the
          updated Privacy Policy.
        </p>

        {/* 11. Contact Information */}
        <h2 className="text-xl font-semibold text-white mt-10 mb-4">
          11. Contact Information
        </h2>
        <p className="text-neutral-300 leading-relaxed mb-4">
          If you have any questions, concerns, or requests regarding this Privacy Policy
          or our data practices, please contact us at:
        </p>
        <ul className="list-none pl-0 text-neutral-300 space-y-2 mb-4">
          <li>
            <strong className="text-white">Email:</strong>{' '}
            <a href="mailto:privacy@sticktomusic.com" className="text-blue-400 hover:text-blue-300 underline">
              privacy@sticktomusic.com
            </a>
          </li>
          <li>
            <strong className="text-white">Website:</strong>{' '}
            <a href="https://sticktomusic.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              sticktomusic.com
            </a>
          </li>
        </ul>
        <p className="text-neutral-300 leading-relaxed mb-4">
          We will make every effort to respond to your inquiry within 30 days.
        </p>

        {/* Footer spacing */}
        <div className="mt-16 pt-8 border-t border-neutral-800">
          <p className="text-neutral-500 text-sm">
            &copy; {new Date().getFullYear()} StickToMusic. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
