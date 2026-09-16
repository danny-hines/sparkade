import type { Metadata } from 'next';
import { LegalPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How Sparkade handles account information, game ideas, photos, and Google sign-in data.',
  alternates: { canonical: '/privacy' },
  openGraph: { title: 'Privacy policy · Sparkade', url: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Sparkade is a service operated by Danny Hines that lets you create, play, and share games.
        This policy covers sparkade.dev and its connected game-generation services. Contact{' '}
        <a href="mailto:dannyhines@gmail.com">dannyhines@gmail.com</a> with privacy questions or
        requests.
      </p>

      <h2>Information we use</h2>
      <ul>
        <li>
          Account information: your authentication identifier, email address and verification
          status, and profile information you provide through our authentication provider, Clerk.
        </li>
        <li>
          Game information: your ideas, chosen hero names, optional uploaded photos, generated
          games, generation progress, review results, and error information needed to operate the
          service.
        </li>
        <li>
          Activity and account records: your Sparkade handle, published games, favorites, plays,
          credits, invite redemptions, and account settings.
        </li>
        <li>
          Technical information: session cookies, browser and network information, request logs, and
          security records processed by Sparkade and its hosting and authentication providers.
        </li>
      </ul>
      <p>
        We use this information to authenticate you, run and secure your account, generate and
        deliver games, manage credits, prevent abuse, review content, troubleshoot problems, and
        respond to support requests. Session cookies keep you signed in; a temporary signup cookie
        preserves your invite choice.
      </p>

      <h2>Sign in with Google</h2>
      <p>
        If you choose Google sign-in, Clerk receives your Google account identifier, email address,
        and basic profile information, such as your name and profile picture. Sparkade uses that
        information for sign-in, account management, security, and support. We do not request access
        to your Gmail messages, Drive files, contacts, or calendar.
      </p>
      <p>
        We do not sell Google account information, use it for advertising, or send the information
        received through Google sign-in to our game-generation models. Your public Sparkade handle
        is separate from your Google email address and name. You can revoke Sparkade&apos;s Google
        access in your{' '}
        <a href="https://myaccount.google.com/connections">Google Account connections</a>. Revoking
        access does not automatically delete your Sparkade account or games.
      </p>

      <h2>Game generation and optional photos</h2>
      <p>
        Game creation sends the ideas and optional photos you submit to configured AI providers,
        including Meta, to generate and review game content. Connected arcade cabinets may also send
        recorded ideas to a transcription provider. These submissions are separate from the Google
        account information used for sign-in.
      </p>
      <p>
        Some configured Meta model tiers may use submitted inputs and generated responses for model
        training. Do not include sensitive information in game ideas or upload a photo unless you
        have permission to use it. AI-generated characters and artwork may reflect your photo and
        become visible when you share the game.
      </p>
      <p>
        Original website photos are held in private generation storage and are not served as public
        game assets. The game owner and authorized administrators may access them while a generation
        is in progress or eligible for recovery. Private generation files may be retained for
        retries and troubleshooting until cleanup runs.
      </p>

      <h2>Sharing and public content</h2>
      <p>
        We use Clerk for authentication, Vercel for hosting and file storage, Neon for application
        records, and configured AI providers for generation and review. These providers process the
        information needed to provide their services. Authorized administrators can access records
        needed for support, moderation, and security. We may also disclose information when required
        by law or needed to investigate misuse and protect users.
      </p>
      <p>
        Published games and creator handles are public. Unlisted games can be played by anyone who
        has their link. Favorites are private, while aggregate play and like counts may be public.
        Unpublishing or deleting a game cannot remove copies other people have already saved. We do
        not sell your personal information.
      </p>

      <h2>Retention and your choices</h2>
      <p>
        We retain account and game records as needed to provide the service, recover from failures,
        manage credits, and investigate abuse. Deleting a game first removes access through Sparkade
        and allows restoration for seven days; it does not immediately erase every stored copy,
        generation record, or log. Backups and records needed for security or legal obligations may
        remain after a deletion request.
      </p>
      <p>
        You can edit your account information through the account menu and manage your games from
        Your arcade. To request access, correction, or deletion of your account and associated data,
        email <a href="mailto:dannyhines@gmail.com">dannyhines@gmail.com</a>. We may ask you to
        verify account ownership before acting on a request.
      </p>

      <h2>Updates</h2>
      <p>
        We will update this page when our practices change. If we introduce a materially different
        use of Google account data, we will disclose it and request any required consent before that
        new use begins.
      </p>
    </LegalPage>
  );
}
