// Traducciones. Cada archivo de ./locales es un idioma: para añadir uno basta con
// copiar es.json con otro nombre (fr.json, pt-br.json…) y traducir los textos.
// Aparece solo en el selector; las claves que falten se toman del español.

import { useMemo, useSyncExternalStore } from 'react';

const modules = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });

const LOCALES = Object.fromEntries(
  Object.entries(modules).map(([path, dict]) => [path.match(/([\w-]+)\.json$/)[1].toLowerCase(), dict]),
);

const FALLBACK = 'es';
const STORAGE_KEY = 'shade_lamp.lang';

export const LANGUAGES = Object.entries(LOCALES)
  .map(([code, dict]) => ({ code, name: dict._meta?.name || code }))
  .sort((a, b) => a.name.localeCompare(b.name));

const lookup = (dict, key) => key.split('.').reduce((node, k) => (node == null ? undefined : node[k]), dict);

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES[saved]) return saved;
  } catch {
    // Sin almacenamiento (modo privado): se usa el idioma del navegador
  }
  for (const tag of navigator.languages || [navigator.language || '']) {
    const code = tag.toLowerCase();
    if (LOCALES[code]) return code;
    const short = code.split('-')[0];
    if (LOCALES[short]) return short;
  }
  return FALLBACK;
}

function makeT(lang) {
  const dict = LOCALES[lang] || {};
  const base = LOCALES[FALLBACK] || {};
  return (key, vars) => {
    const text = lookup(dict, key) ?? lookup(base, key) ?? key;
    if (typeof text !== 'string' || !vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  };
}

let current = detectLanguage();
const listeners = new Set();

/** Ajusta lo que vive fuera de React: idioma del documento, título y descripción. */
function applyToDocument() {
  const t = makeT(current);
  document.documentElement.lang = LOCALES[current]?._meta?.locale || current;
  document.title = t('app.documentTitle');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}
applyToDocument();

export function setLanguage(code) {
  if (!LOCALES[code] || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // La elección solo dura esta sesión
  }
  applyToDocument();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getLanguage = () => current;

/**
 * Idioma actual. t('clave.anidada', { variable }) devuelve el texto traducido;
 * locale sirve para formatear números (toLocaleString).
 */
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLanguage);
  return useMemo(() => ({
    lang,
    locale: LOCALES[lang]?._meta?.locale || lang,
    t: makeT(lang),
  }), [lang]);
}
