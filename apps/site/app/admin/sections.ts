export const adminSections = [
  { href: '/admin', label: 'Overview', description: 'Find your tools and recent admin activity.' },
  {
    href: '/admin/kiosks',
    label: 'Kiosks',
    description: 'Pair cabinets, rename them, and manage device access.',
  },
  {
    href: '/admin/games',
    label: 'Games',
    description: 'Browse the game library and manage cabinet feed visibility.',
  },
  {
    href: '/admin/invites',
    label: 'Invites',
    description: 'Create signup links with starting credits and usage limits.',
  },
  {
    href: '/admin/creation',
    label: 'Creation',
    description: 'Review generated games and control provider spending.',
  },
  {
    href: '/admin/accounts',
    label: 'Accounts',
    description: 'Grant credits and manage account access.',
  },
] as const;
