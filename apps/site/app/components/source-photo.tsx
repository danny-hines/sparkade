export function SourcePhoto({ gameId }: { gameId: string }) {
  return (
    <figure className="arc-review-photo">
      <img
        src={`/api/me/games/${gameId}/photo`}
        alt="Submitted hero reference photo"
        width={256}
        height={256}
        loading="lazy"
      />
      <figcaption>Private hero reference · visible to its creator and reviewers</figcaption>
    </figure>
  );
}
