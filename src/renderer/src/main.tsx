import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, browserStore, loadTheme } from './lib/theme'

// 在第一次渲染前套用主題，避免開啟時閃一下淺色
applyTheme(document.documentElement, loadTheme(browserStore()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
