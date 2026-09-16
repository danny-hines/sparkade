export interface GameNotification {
  id: string;
  gameId: string;
  title: string;
  kind: 'ready' | 'rejected' | 'failed' | 'removed';
  createdAt: string;
  read: boolean;
}
export interface NotificationSnapshot {
  userKey: string;
  cursor: string;
  unread: number;
  items: GameNotification[];
}
export function notificationMessage(kind: GameNotification['kind']) {
  return {
    ready: 'Your game is ready to play',
    rejected: 'Game rejected · credits returned',
    failed: 'Generation failed · credits returned',
    removed: 'Game removed from sharing',
  }[kind];
}
