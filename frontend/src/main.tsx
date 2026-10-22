import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Не найден корневой элемент');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
