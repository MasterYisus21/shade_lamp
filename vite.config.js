import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas: el build funciona en cualquier carpeta (GitHub Pages, Netlify, Cloudflare Pages…)
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
