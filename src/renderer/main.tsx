import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Popup from './Popup';
import { useStore } from './store';
import './styles.css';

// Dev-only: lets automated checks drive the same store the UI uses
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;

// The same bundle also draws the small "call detected" window (#popup)
const isPopup = location.hash === '#popup';
createRoot(document.getElementById('root')!).render(<StrictMode>{isPopup ? <Popup /> : <App />}</StrictMode>);
