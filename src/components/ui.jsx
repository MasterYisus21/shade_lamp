// Componentes básicos de la interfaz.

import React, { useState } from 'react';

const decimalsOf = (step) => {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

/**
 * Campo numérico con deslizador. El número se puede escribir libremente y se
 * aplica al salir del campo o con Enter (Escape cancela).
 */
export function Field({ label, unit, value, min, max, step, onChange, digits, hint }) {
  const dec = digits ?? decimalsOf(step);
  const shown = Number(value).toFixed(dec);
  const [draft, setDraft] = useState(null);
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(String(draft).replace(',', '.'));
    if (Number.isFinite(v)) onChange(clamp(v));
    setDraft(null);
  };
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-row">
        <input
          type="range"
          className="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          style={{ '--pct': `${Math.min(100, Math.max(0, pct))}%` }}
          onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
        />
        <div className="num">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${label} (${unit || 'valor'})`}
            value={draft ?? shown}
            onFocus={(e) => { setDraft(shown); e.target.select(); }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') { setDraft(null); e.target.blur(); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const v = clamp(Number(value) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1));
                onChange(Number(v.toFixed(dec + 2)));
                setDraft(null);
              }
            }}
          />
          {unit && <span className="num-unit">{unit}</span>}
        </div>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Selector segmentado. options: [{ value, label, icon? }] */
export function Segmented({ value, onChange, options, label, small }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className={`segmented${small ? ' small' : ''}`} role="radiogroup">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'on' : ''}
            onClick={() => onChange(o.value)}
            title={o.title}
          >
            {o.icon}
            {o.label && <span>{o.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label, description }) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {description && <span className="hint">{description}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SelectField({ label, value, onChange, options }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Card({ title, icon, action, children }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          <h3>{icon}{title}</h3>
          {action}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function IconToggle({ active, onClick, icon, label, title }) {
  return (
    <button type="button" className={`icon-toggle${active ? ' on' : ''}`} onClick={onClick} title={title || label} aria-pressed={active}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
