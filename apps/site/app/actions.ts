'use server';

import { addWaitlistSubscriber } from '@/lib/waitlist';

export type WaitlistState = {
  status: 'idle' | 'joined' | 'duplicate' | 'invalid' | 'unavailable';
  message: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function joinWaitlist(
  _previousState: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  // Honeypot: ordinary visitors never see or fill this field.
  if (String(formData.get('website') ?? '').trim()) {
    return { status: 'joined', message: "You're on the list. We'll be in touch." };
  }

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { status: 'invalid', message: 'Enter a valid email address.' };
  }

  try {
    const result = await addWaitlistSubscriber(email, 'homepage');
    if (result === 'duplicate') {
      return { status: 'duplicate', message: "You're already on the list—we saved your spot." };
    }
    return {
      status: 'joined',
      message: "You're in. We'll send the good stuff, not the noisy stuff.",
    };
  } catch (error) {
    console.error('Waitlist signup failed', error instanceof Error ? error.name : 'UnknownError');
    return {
      status: 'unavailable',
      message: 'The signup machine needs a quick reset. Please try again in a moment.',
    };
  }
}
