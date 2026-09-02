import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PublicGameLink } from '@sparkade/shared';
import type { Screen } from '../app';
import { FooterLegend } from '../components';
import { shellInput } from '../shell-input';
import { PublicGameQrCard } from './generation';

export function ShareScreen(props: {
  go: (screen: Screen) => void;
  gameId: string;
  title: string;
  link: PublicGameLink;
}): ComponentChildren {
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(
    () =>
      shellInput.pushHandler((button) => {
        if (button !== 'B') return;
        shellInput.blip('back');
        propsRef.current.go({ name: 'home', id: propsRef.current.gameId });
      }),
    [],
  );

  return (
    <div class="screen share-screen">
      <div class="screen-title">
        <h2 class="pixel">SHARE GAME</h2>
        <span class="chip published-chip">PUBLISHED</span>
      </div>
      <div class="share-game-title">{props.title}</div>
      <div class="share-game-card">
        <PublicGameQrCard link={props.link} mode="ready" />
      </div>
      <FooterLegend items={[['B', 'Details']]} />
    </div>
  );
}
