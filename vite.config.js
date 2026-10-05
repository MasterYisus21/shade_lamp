import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// Política de seguridad del sitio publicado: todo se sirve desde el propio
// dominio y la página no puede cargar ni enviar nada a terceros. Las imágenes
// del usuario se leen como blob: y el motor corre en workers propios.
const CSP = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self'",
  'img-src': "'self' data: blob:", // data: = iconos SVG del CSS
  'font-src': "'self'",
  'worker-src': "'self'",
  'connect-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'none'",
}
const cspValue = (extra = {}) => Object.entries({ ...CSP, ...extra }).map(([k, v]) => `${k} ${v}`).join('; ')

/**
 * Solo en el build (el servidor de desarrollo necesita scripts y estilos en
 * línea): añade la CSP como <meta>, que funciona en cualquier hosting, y genera
 * `_headers` (Netlify, Cloudflare Pages) con cabeceras que una <meta> no puede poner.
 */
function securityHeaders() {
  return {
    name: 'security-headers',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: cspValue() }, injectTo: 'head-prepend' }]
    },
    generateBundle() {
      const headers = {
        'Content-Security-Policy': cspValue({ 'frame-ancestors': "'none'" }),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
      }
      const source = `/*\n${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`
      this.emitFile({ type: 'asset', fileName: '_headers', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas: el build funciona en cualquier carpeta (GitHub Pages, Netlify, Cloudflare Pages…)
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    securityHeaders(),
  ],
})
