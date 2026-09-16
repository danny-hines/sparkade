export class UsernameError extends Error {}

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/;

// A small, deterministic English-language filter for the friends beta. This is
// basic screening, not a replacement for reports or human moderation.
const blockedFragments = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'cock',
  'pussy',
  'porn',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'kike',
  'chink',
  'retard',
  'nazi',
  'hitler',
  'heilhitler',
];
const blockedWords = new Set(['ass', 'dick', 'sex', 'rape', 'kkk']);
const reserved = [
  'admin',
  'administrator',
  'moderator',
  'support',
  'staff',
  'official',
  'sparkade',
];
const aliases: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
};

export function validateUsername(input: string): string {
  const handle = input.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(handle)) {
    throw new UsernameError(
      'Use 3–24 letters, numbers, underscores, or hyphens. Start and end with a letter or number.',
    );
  }
  const normalized = handle.replace(/[0134578]/g, (digit) => aliases[digit]);
  const compact = normalized.replace(/[-_]/g, '');
  if (/^player[-_]/.test(handle) || reserved.some((word) => compact.startsWith(word))) {
    throw new UsernameError('That username is reserved. Please choose another.');
  }
  if (
    blockedFragments.some((word) => compact.includes(word)) ||
    normalized.split(/[-_0-9]+/).some((word) => blockedWords.has(word)) ||
    blockedWords.has(compact)
  ) {
    throw new UsernameError('Please choose a username without offensive or explicit language.');
  }
  return handle;
}
