import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store.js';
import { I18nProvider } from './i18n/I18nProvider.jsx';
import App from './App.jsx';
import '@coreui/coreui/dist/css/coreui.min.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <I18nProvider><App /></I18nProvider>
    </Provider>
  </StrictMode>,
);
