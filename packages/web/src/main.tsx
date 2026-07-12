import { render } from 'preact';
import { App } from './app';
import { shellInput } from './shell-input';
import './styles.css';

shellInput.start();
render(<App />, document.getElementById('root')!);
