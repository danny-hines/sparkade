import { redirect } from 'next/navigation';
import { SiteFrame, viewer } from '../../components/site-frame';
import { UsernameForm } from './username-form';

export const metadata = { title: 'Edit profile', robots: { index: false, follow: false } };

export default async function EditProfilePage() {
  const user = await viewer();
  if (!user) redirect('/sign-in?redirect_url=/me/profile');
  return (
    <SiteFrame active="profile">
      <section className="arc-hero">
        <span className="arc-kicker">Make yourself at home</span>
        <h1>Edit profile</h1>
        <p>Your username appears on your games and public profile.</p>
      </section>
      <section className="arc-panel arc-profile-editor" aria-label="Profile settings">
        <UsernameForm handle={user.handle} suspended={user.suspended} />
      </section>
    </SiteFrame>
  );
}
