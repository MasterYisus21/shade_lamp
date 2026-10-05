// Tutorial guiado: resalta cada parte de la interfaz con una explicación corta.
// Los pasos apuntan a elementos con data-tour="…"; los textos están en tour.* (i18n).

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useI18n } from '../i18n';

// tab: pestaña del panel que debe estar abierta para ver el elemento
const STEPS = [
  { id: 'welcome' },
  { id: 'image', target: 'image', tab: 'image' },
  { id: 'interpretation', target: 'interpretation', tab: 'image' },
  { id: 'viewer', target: 'viewer-light' },
  { id: 'tabs', target: 'tabs' },
  { id: 'export', target: 'export' },
  { id: 'project', target: 'project' },
  { id: 'done' },
];

const GAP = 14;
const MARGIN = 12;
const POP_WIDTH = 330;

/** Lámpara, luz y sombra: el concepto en un dibujo. */
function Illustration() {
  return (
    <svg className="tour-art" viewBox="0 0 300 120" aria-hidden="true">
      <defs>
        <radialGradient id="tour-glow">
          <stop offset="0" stopColor="var(--accent-strong)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Rayos que salen por los huecos */}
      <path d="M70 60 L268 7 L268 34 Z M70 60 L268 86 L268 113 Z" fill="var(--accent)" opacity="0.18" />
      <circle cx="70" cy="60" r="34" fill="url(#tour-glow)" />
      {/* Pantalla con dos huecos */}
      <path d="M100 14 V52 M100 56 V64 M100 68 V106" stroke="var(--text-1)" strokeWidth="4" />
      <path d="M40 14 V106 M40 14 H100 M40 106 H100" stroke="var(--text-2)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="70" cy="60" r="7" fill="var(--accent-strong)" />
      {/* Pared con la imagen proyectada */}
      <rect x="268" y="4" width="10" height="112" rx="2" fill="var(--bg-3)" />
      <path d="M268 7 V34 M268 86 V113" stroke="var(--accent-strong)" strokeWidth="4" />
    </svg>
  );
}

export default function Tour({ onClose, onTab }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState(null); // { spot, pop } en px
  const popRef = useRef(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const counted = STEPS.length - 2; // sin bienvenida ni cierre

  // La pestaña cambia junto con el paso, así el elemento ya existe al medir
  const goTo = (i) => {
    const target = STEPS[Math.min(STEPS.length - 1, Math.max(0, i))];
    if (target.tab) onTab(target.tab);
    setIndex(STEPS.indexOf(target));
  };

  // Posición del resaltado y del globo
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target && document.querySelector(`[data-tour="${step.target}"]`);
      const pop = popRef.current;
      if (!el || !pop) {
        setLayout(null);
        return;
      }
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ph = pop.offsetHeight;
      // Resaltado 6 px más grande que el elemento, sin salirse de la ventana
      const sx = Math.max(2, r.left - 6);
      const sy = Math.max(2, r.top - 6);
      const spot = {
        left: sx,
        top: sy,
        width: Math.min(vw - 2, r.right + 6) - sx,
        height: Math.min(vh - 2, r.bottom + 6) - sy,
      };
      const clampX = (x) => Math.min(vw - POP_WIDTH - MARGIN, Math.max(MARGIN, x));
      const clampY = (y) => Math.min(vh - ph - MARGIN, Math.max(MARGIN, y));
      let popPos;
      if (r.right + GAP + POP_WIDTH < vw - MARGIN) popPos = { left: r.right + GAP, top: clampY(r.top) };
      else if (r.bottom + GAP + ph < vh - MARGIN) popPos = { left: clampX(r.left), top: r.bottom + GAP };
      else if (r.top - GAP - ph > MARGIN) popPos = { left: clampX(r.left), top: r.top - GAP - ph };
      else popPos = { left: clampX(r.left - GAP - POP_WIDTH), top: clampY(r.top) };
      setLayout({ spot, pop: popPos });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  const keysRef = useRef(null);
  useEffect(() => {
    keysRef.current = { goTo, index, onClose };
  });
  useEffect(() => {
    const onKey = (e) => {
      const { goTo: go, index: i, onClose: close } = keysRef.current;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const next = () => (last ? onClose() : goTo(index + 1));
  const centered = !step.target || !layout;

  return (
    <div className={`tour${centered ? ' centered' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {centered ? <div className="tour-backdrop" /> : <div className="tour-spot" style={layout.spot} />}
      <div
        ref={popRef}
        className="tour-pop"
        style={centered ? undefined : { left: layout.pop.left, top: layout.pop.top, width: POP_WIDTH }}
      >
        <button type="button" className="tour-close" onClick={onClose} aria-label={t('tour.skip')} title={t('tour.skip')}>
          <X size={14} />
        </button>
        {step.id === 'welcome' && <Illustration />}
        {index > 0 && !last && <span className="tour-count">{t('tour.count', { n: index, total: counted })}</span>}
        <h2 id="tour-title">{t(`tour.steps.${step.id}.title`)}</h2>
        <p>{t(`tour.steps.${step.id}.text`)}</p>
        <div className="tour-actions">
          {index === 0 ? (
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('tour.later')}</button>
          ) : !last && (
            <button type="button" className="btn btn-ghost" onClick={() => goTo(index - 1)}>
              <ChevronLeft size={15} />{t('tour.back')}
            </button>
          )}
          <span className="tour-dots" aria-hidden="true">
            {STEPS.map((s, i) => <i key={s.id} className={i === index ? 'on' : ''} />)}
          </span>
          <button type="button" className="btn btn-primary" onClick={next} autoFocus>
            {index === 0 ? t('tour.start') : last ? t('tour.finish') : t('tour.next')}
            {!last && <ChevronRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
