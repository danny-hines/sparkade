export interface CreationPromptInput {
  heroName: string;
  archetypeLabel: string;
  details: string;
}

/** Readable fallback prompt for the generation pipeline. Each empty field is
 * explicit so automatic choices remain intentional rather than looking like
 * missing form data. Structured fields are submitted alongside this text. */
export function buildCreationPrompt(input: CreationPromptInput): string {
  return [
    input.heroName ? `${input.heroName} is the main character.` : 'Muse decides the hero name.',
    input.archetypeLabel
      ? `Make it a ${input.archetypeLabel} game.`
      : 'Muse decides the game type.',
    input.details || 'Muse decides the story, enemies, setting, and visual style.',
  ].join(' ');
}
