import type { Metadata } from 'next';
import { LegalPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The terms for using Sparkade to create, play, and share games.',
  alternates: { canonical: '/terms' },
  openGraph: { title: 'Terms of service · Sparkade', url: '/terms' },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms apply to your use of Sparkade at sparkade.dev, operated by Danny Hines. By using
        the service, you agree to these terms. Our <a href="/privacy">privacy policy</a> explains
        how we handle your information.
      </p>

      <h2>Your account and use of the service</h2>
      <p>
        Provide accurate account information, protect your sign-in credentials, and use Sparkade
        only where you are legally permitted to do so. If you need a parent or guardian&apos;s
        permission to use the service, obtain it before using Sparkade. Tell us if you believe
        someone has accessed your account without permission.
      </p>

      <h2>Your ideas, photos, and games</h2>
      <p>
        Only submit content you have permission to use, including permission from people whose
        photos you upload. You retain any rights you already hold in your submissions. You give
        Sparkade permission to store, process, and send your submissions to its service providers as
        needed to generate, review, host, and deliver your games.
      </p>
      <p>
        If you publish or share a game, you authorize Sparkade to display and distribute that game,
        its artwork, and your public creator handle so other people can play it. You can unpublish
        or delete it using the available controls. Other people may retain copies they have already
        saved, and our retention practices are described in the privacy policy.
      </p>
      <p>
        AI-generated output can contain errors and may resemble other content. We do not promise
        that generated content is unique or that it qualifies for exclusive intellectual-property
        rights. Review your game before publishing or using it elsewhere.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not submit unlawful content, infringe someone else&apos;s rights, impersonate others,
        upload harmful software, harass people, or attempt to bypass access controls, content
        review, credit limits, or other protections. We may restrict accounts or remove content to
        address misuse, security issues, legal requirements, or violations of these terms.
      </p>

      <h2>Credits and availability</h2>
      <p>
        Credits are used for game creation according to the price shown before submission. Invite
        offers may have eligibility conditions, expiration dates, and limited availability. Credits
        are service credits, not money, and cannot be redeemed for cash. Any future paid offers will
        disclose their price and applicable terms before purchase.
      </p>
      <p>
        Sparkade is in beta. Features may change, creation may be paused, and games or accounts may
        be temporarily unavailable. We do not guarantee uninterrupted availability or that every
        generation request will produce a usable game. Nothing in these terms limits rights that
        applicable law does not allow us to limit.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms as the service changes and will provide notice of material
        changes. Contact <a href="mailto:dannyhines@gmail.com">dannyhines@gmail.com</a> for support,
        questions about these terms, or account and content requests.
      </p>
    </LegalPage>
  );
}
