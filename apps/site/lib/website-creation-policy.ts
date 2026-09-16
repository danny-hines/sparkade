/** Counts queued, generating and review-pending games with a held credit charge. */
export const MAX_ACTIVE_WEBSITE_GAMES = 3;
export interface ActiveWebsiteGame {
  id: string;
  title: string;
}
