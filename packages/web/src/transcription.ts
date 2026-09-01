/** Remove sentence punctuation ASR adds to a spoken hero name. Internal name
 * punctuation remains intact, and an all-initials name such as "J.R.R." keeps
 * its conventional periods. */
export function normalizeTranscribedHeroName(transcript: string): string {
  const name = transcript.trim();
  if (/^(?:[\p{L}\p{N}]\.)+$/u.test(name)) return name;
  return name.replace(/[.,!?;:]+$/u, '').trimEnd();
}
