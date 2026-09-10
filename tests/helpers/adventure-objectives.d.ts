export function checkAdventureObjectives(): {
  title: string;
  style: string;
  seconds: number;
  results: { name: string; pass: boolean; outcome?: string; score?: number; visited?: number }[];
};
