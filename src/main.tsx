import { TextSelection } from 'prosemirror-state';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import * as store from './storage/db';
import { layoutKey } from './editor/layoutPlugin';
import { makePdf } from './ui/actions';
import './ui/theme.css';

registerSW({ immediate: true });

// Small hook for end-to-end tests and debugging from the console.
(window as any).__ud = { makePdf, store, layoutKey, pm: { TextSelection } };

createRoot(document.getElementById('root')!).render(<App />);
