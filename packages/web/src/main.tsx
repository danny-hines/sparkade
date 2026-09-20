import { render } from 'preact';
import { App } from './app';
import { shellInput } from './shell-input';
import { KioskViewport } from './kiosk-viewport';
import { installPortalGamepad } from './portal-gamepad';
import { initializePortalRuntime } from './portal-runtime';
import './styles.css';

void initializePortalRuntime()
  .then(() => {
    shellInput.start();
    if (navigator.userAgent.includes('SparkadePortal/')) installPortalGamepad(shellInput.broker);
    render(
      <KioskViewport>
        <App />
      </KioskViewport>,
      document.getElementById('root')!,
    );
  })
  .catch((error: Error) => {
    const root = document.getElementById('root')!;
    root.textContent = `Sparkade could not open local storage: ${error.message}`;
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = () => location.reload();
    root.appendChild(retry);
  });
