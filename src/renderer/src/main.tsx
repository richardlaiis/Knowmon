import 'katex/dist/katex.min.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, browserStore, loadTheme } from './lib/theme'

// Apply the theme before the first render to avoid a light flash on startup
applyTheme(document.documentElement, loadTheme(browserStore()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
