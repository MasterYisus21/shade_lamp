import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuente incluida en el sitio (sin peticiones a Google Fonts)
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
