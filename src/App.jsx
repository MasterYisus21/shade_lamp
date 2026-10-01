import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Image as ImageIcon, Lamp, Grid3x3, Puzzle, Download, Eye, EyeOff, LoaderCircle, Cylinder, Box,
  FlipHorizontal2, FlipVertical2, Lock, Unlock, Sun, Moon, Focus, Expand, Shrink, Lightbulb, Check,
  TriangleAlert, Info, X, Move,
} from 'lucide-react';
import Scene from './Scene';
import { LIGHT_COLORS } from './theme';
import { Field, Segmented, Switch, SelectField, Card, IconToggle } from './components/ui';
import ImageDrop from './components/ImageDrop';
import { createPreviewEngine, exportStl, exportPartStl } from './engine/client';
import { loadImageLuminance, defaultImage } from './engine/image';
import { QUALITY } from './core/engine';
import { DEFAULT_PARTS } from './core/parts';
import './index.css';

// Holgura del encastre según el tipo de impresión (mm)
const NOZZLES = {
  '0.4': { label: 'FDM 0.4', clearance: 0.2 },
  '0.2': { label: 'FDM 0.2', clearance: 0.15 },
  resin: { label: 'Resina', clearance: 0.1 },
};

const BRIDGES = [
  { value: 'none', label: 'Sin puentes' },
  { value: 'vertical', label: 'Verticales' },
  { value: 'horizontal', label: 'Horizontales' },
  { value: 'diagonal_45', label: 'Diagonal +45°' },
  { value: 'diagonal_neg45', label: 'Diagonal −45°' },
  { value: 'grid', label: 'Cuadrícula' },
  { value: 'diagonal_cross', label: 'Malla cruzada' },
];

const TABS = [
  { id: 'image', label: 'Imagen', icon: <ImageIcon size={16} /> },
  { id: 'lamp', label: 'Lámpara', icon: <Lamp size={16} /> },
  { id: 'bridges', label: 'Puentes', icon: <Grid3x3 size={16} /> },
  { id: 'parts', label: 'Piezas', icon: <Puzzle size={16} /> },
];

const PART_LABELS = { shade: 'Pantalla', cap: 'Tapa', base: 'Base', post: 'Poste' };
const PART_FILES = { base: 'base', cap: 'tapa', post: 'poste' };

function downloadBuffer(buffer, name) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/stl' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const round1 = (v) => Math.round(v * 10) / 10;

function App() {
  const [tab, setTab] = useState('image');

  // Bombillo (cm)
  const [bulbRadius, setBulbRadius] = useState(0.5);
  const [distance, setDistance] = useState(5.8);

  // Geometría (cm, grosores en mm)
  const [shapeType, setShapeType] = useState('cylinder');
  const [radius, setRadius] = useState(3);
  const [boxWidth, setBoxWidth] = useState(15);
  const [boxDepth, setBoxDepth] = useState(10);
  const [boxCornerRadius, setBoxCornerRadius] = useState(2);
  const [height, setHeight] = useState(6);
  const [thickness, setThickness] = useState(2);
  const [rim, setRim] = useState(4);

  // Imagen (cm)
  const [imageName, setImageName] = useState(null);
  const [imageData, setImageData] = useState(() => defaultImage());
  const [imgOffsetX, setImgOffsetX] = useState(0);
  const [imgOffsetY, setImgOffsetY] = useState(0);
  const [imgScaleX, setImgScaleX] = useState(25);
  const [imgScaleY, setImgScaleY] = useState(25);
  const [lockAspect, setLockAspect] = useState(true);
  const [imgRotation, setImgRotation] = useState(0);
  const [imgFlipX, setImgFlipX] = useState(false);
  const [imgFlipY, setImgFlipY] = useState(false);
  const [invertShadow, setInvertShadow] = useState(false);
  const [dragImage, setDragImage] = useState(false);

  // Puentes (mm)
  const [supportType, setSupportType] = useState('none');
  const [supportThickness, setSupportThickness] = useState(0.8);
  const [supportSpacing, setSupportSpacing] = useState(20);

  // Impresión y piezas (mm)
  const [nozzle, setNozzle] = useState('0.4');
  const [partsEnabled, setPartsEnabled] = useState(true);
  const [baseThickness, setBaseThickness] = useState(DEFAULT_PARTS.baseThickness);
  const [capThickness, setCapThickness] = useState(DEFAULT_PARTS.capThickness);
  const [lipLength, setLipLength] = useState(DEFAULT_PARTS.lipLength);
  const [clearance, setClearance] = useState(NOZZLES['0.4'].clearance);
  const [postDiameter, setPostDiameter] = useState(DEFAULT_PARTS.postOuterRadius * 2);
  const [cableDiameter, setCableDiameter] = useState(DEFAULT_PARTS.cableRadius * 2);

  // Visor
  const [showWall, setShowWall] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [visibleParts, setVisibleParts] = useState({ shade: true, cap: true, base: true, post: true });
  const [wallTone, setWallTone] = useState('dark');
  const [lightColor, setLightColor] = useState('warm');
  const [cameraKey, setCameraKey] = useState(0);
  const [preview, setPreview] = useState(null);
  const [computing, setComputing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [imageLoading, setImageLoading] = useState(null); // { progress, stage }
  const awaitingImageRef = useRef(false); // la carga termina cuando llega la vista previa con la imagen nueva
  const sentImageRef = useRef(null);

  // Exportación
  const [exportQuality, setExportQuality] = useState('high');
  const [exporting, setExporting] = useState(null); // { progress }
  const [toast, setToast] = useState(null);

  // Límites físicos
  const innerHalf = shapeType === 'cylinder' ? radius : Math.min(boxWidth, boxDepth) / 2;
  const maxBulbRadius = Math.max(0.1, innerHalf - thickness / 10);
  const effBulbRadius = Math.min(bulbRadius, maxBulbRadius);
  const gapCm = partsEnabled ? baseThickness / 10 : 0; // la base separa la pantalla de la pared
  const maxDistance = Math.max(1, height - 0.5 + gapCm); // el bombillo va dentro de la pantalla
  const effDistance = Math.min(distance, maxDistance);
  const maxCorner = Math.min(boxWidth, boxDepth) / 2;
  const effCorner = Math.min(boxCornerRadius, maxCorner);
  const maxThickness = Math.max(0.8, Math.min(10, innerHalf * 10 * 0.5));
  const effThickness = Math.min(thickness, maxThickness);
  // El labio de la base y la tapa entra en la pantalla: esa zona debe ser sólida
  const effRim = partsEnabled ? Math.max(rim, lipLength + 1) : rim;
  const maxPostDiameter = Math.max(4, Math.floor((innerHalf * 10 - effThickness) * 2 * 0.5));
  const effPostDiameter = Math.min(postDiameter, maxPostDiameter);
  const effCableDiameter = Math.min(cableDiameter, effPostDiameter - 1.6);
  const imageAspect = imageData.height / imageData.width;
  const bulbDepth = height + gapCm - effDistance;

  // Parámetros del motor, todo en mm
  const engineParams = useMemo(() => ({
    shape: shapeType === 'cylinder'
      ? { type: 'cylinder', radius: radius * 10 }
      : { type: 'box', width: boxWidth * 10, depth: boxDepth * 10, cornerRadius: effCorner * 10 },
    thickness: effThickness,
    height: height * 10,
    distance: effDistance * 10,
    bulbRadius: effBulbRadius * 10,
    rimWall: effRim,
    rimRoom: effRim,
    parts: {
      ...DEFAULT_PARTS,
      enabled: partsEnabled,
      baseThickness,
      capThickness,
      lipLength,
      clearance,
      postOuterRadius: effPostDiameter / 2,
      cableRadius: effCableDiameter / 2,
    },
    image: {
      offsetX: imgOffsetX * 10,
      offsetY: imgOffsetY * 10,
      scaleX: imgScaleX * 10,
      scaleY: imgScaleY * 10,
      rotation: imgRotation,
      flipX: imgFlipX,
      flipY: imgFlipY,
      invert: invertShadow,
    },
    bridges: { type: supportType, width: supportThickness, spacing: supportSpacing },
  }), [shapeType, radius, boxWidth, boxDepth, effCorner, effThickness, height, effDistance, effBulbRadius, effRim,
    imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, imgRotation, imgFlipX, imgFlipY, invertShadow,
    supportType, supportThickness, supportSpacing,
    partsEnabled, baseThickness, capThickness, lipLength, clearance, effPostDiameter, effCableDiameter]);

  // Motor de vista previa (worker)
  const engineRef = useRef(null);
  useEffect(() => {
    const engine = createPreviewEngine(
      (msg, hasPending) => {
        setPreview(msg);
        setPreviewError(null);
        if (!hasPending) {
          setComputing(false);
          if (awaitingImageRef.current) {
            awaitingImageRef.current = false;
            setImageLoading(null);
          }
        }
      },
      (message) => {
        setPreviewError(message);
        setComputing(false);
        awaitingImageRef.current = false;
        setImageLoading(null);
      },
    );
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  useEffect(() => {
    engineRef.current?.setImage(imageData);
  }, [imageData]);

  useEffect(() => {
    setComputing(true);
    // A partir de esta petición, la vista previa ya usa la imagen nueva
    if (sentImageRef.current !== imageData) {
      sentImageRef.current = imageData;
      awaitingImageRef.current = true;
    }
    engineRef.current?.request(engineParams, showWall);
  }, [engineParams, imageData, showWall]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // Imagen
  const setWidthKeepingAspect = (w) => {
    setImgScaleX(w);
    if (lockAspect) setImgScaleY(round1(w * imageAspect));
  };
  const setHeightKeepingAspect = (h) => {
    setImgScaleY(h);
    if (lockAspect) setImgScaleX(round1(h / imageAspect));
  };

  const handleImageFile = async (file) => {
    if (imageLoading) return;
    setImageLoading({ progress: 0, stage: 'Leyendo la imagen' });
    try {
      const data = await loadImageLuminance(file, (progress, stage) => setImageLoading({ progress, stage }));
      setImageLoading({ progress: 0.85, stage: 'Calculando la lámpara' });
      setImageName(file.name.substring(0, file.name.lastIndexOf('.')) || file.name);
      setImageData(data);
      if (lockAspect) setImgScaleY(round1(imgScaleX * (data.height / data.width)));
    } catch (err) {
      setImageLoading(null);
      setToast({ kind: 'error', text: err.message });
    }
  };

  // Arrastre con el mouse en la vista 3D (cm, mismo rango que los campos)
  const handleImageDrag = (x, y) => {
    const clampPos = (v) => Math.min(70, Math.max(-70, round1(v)));
    setImgOffsetX(clampPos(x));
    setImgOffsetY(clampPos(y));
  };

  const handleRemoveImage = () => {
    setImageName(null);
    setImageData(defaultImage());
    if (lockAspect) setImgScaleY(imgScaleX);
  };

  // Exportación
  const baseName = `lampara_${imageName || 'prueba'}`;

  const handleExport = async () => {
    setExporting({ progress: 0 });
    try {
      const result = await exportStl(engineParams, imageData, exportQuality, (p) => setExporting({ progress: p }));
      const name = `${baseName}_pantalla_${exportQuality}.stl`;
      downloadBuffer(result.buffer, name);
      setToast({
        kind: 'ok',
        text: `${name} · ${result.triangles.toLocaleString('es')} triángulos · ${(result.buffer.byteLength / 1e6).toFixed(1)} MB · ${(result.ms / 1000).toFixed(1)} s`
          + (result.coarsened ? ` · celda ampliada a ${result.cell.toFixed(3)} mm por el tamaño` : ''),
      });
    } catch (err) {
      console.error('Error generando STL:', err);
      setToast({ kind: 'error', text: `No se pudo generar el STL: ${err.message}` });
    } finally {
      setExporting(null);
    }
  };

  const handlePartExport = (kind) => {
    const name = `${baseName}_${PART_FILES[kind]}.stl`;
    downloadBuffer(exportPartStl(engineParams, kind), name);
    setToast({ kind: 'ok', text: `${name} descargado` });
  };

  const sceneSize = Math.max(height, shapeType === 'cylinder' ? radius : Math.max(boxWidth, boxDepth) / 2);
  const partKinds = partsEnabled ? ['shade', 'cap', 'base', 'post'] : ['shade'];

  return (
    <div className="app">
      {/* ───────────── Panel lateral ───────────── */}
      <aside className="panel">
        <header className="brand">
          <div className="brand-mark"><Lightbulb size={18} /></div>
          <div>
            <h1>Lámpara de Sombras</h1>
            <p>Pantallas que proyectan tu imagen · STL para imprimir</p>
          </div>
        </header>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="panel-scroll">
          {tab === 'image' && (
            <>
              <Card title="Imagen">
                <ImageDrop
                  image={imageData}
                  name={imageName}
                  isCustom={!!imageName}
                  onFile={handleImageFile}
                  onRemove={handleRemoveImage}
                />
                <p className="hint">Usa imágenes en blanco y negro. Con SVG los bordes salen más limpios; lo transparente cuenta como blanco.</p>
              </Card>

              <Card title="Interpretación">
                <Segmented
                  label="Lo negro de la imagen será"
                  value={invertShadow ? 'shadow' : 'light'}
                  onChange={(v) => setInvertShadow(v === 'shadow')}
                  options={[
                    { value: 'light', label: 'Luz', icon: <Sun size={14} /> },
                    { value: 'shadow', label: 'Sombra', icon: <Moon size={14} /> },
                  ]}
                />
                <p className="hint">
                  {invertShadow
                    ? 'Las zonas negras quedan en sombra: la lámpara las tapa con material.'
                    : 'Las zonas negras se iluminan: la lámpara las recorta como huecos.'}
                </p>
              </Card>

              <Card
                title="Posición en la pared"
                action={(
                  <IconToggle
                    active={lockAspect}
                    onClick={() => setLockAspect((v) => !v)}
                    icon={lockAspect ? <Lock size={14} /> : <Unlock size={14} />}
                    title={lockAspect ? 'Proporción bloqueada' : 'Proporción libre'}
                  />
                )}
              >
                <Field label="Ancho" unit="cm" value={imgScaleX} min={1} max={150} step={0.5} onChange={setWidthKeepingAspect} />
                <Field label="Alto" unit="cm" value={imgScaleY} min={1} max={150} step={0.5} onChange={setHeightKeepingAspect} />
                <Field label="Posición X" unit="cm" value={imgOffsetX} min={-70} max={70} step={0.1} onChange={setImgOffsetX} />
                <Field label="Posición Y" unit="cm" value={imgOffsetY} min={-70} max={70} step={0.1} onChange={setImgOffsetY} />
                <Field label="Rotación" unit="°" value={imgRotation} min={-180} max={180} step={1} onChange={setImgRotation} />
                <Switch
                  checked={dragImage}
                  onChange={setDragImage}
                  label="Mover con el mouse"
                  description="Arrastra la imagen sobre la pared en la vista 3D. Fuera de la imagen, la cámara gira como siempre."
                />
                <div className="toggle-row">
                  <IconToggle active={imgFlipX} onClick={() => setImgFlipX((v) => !v)} icon={<FlipHorizontal2 size={14} />} label="Reflejar X" />
                  <IconToggle active={imgFlipY} onClick={() => setImgFlipY((v) => !v)} icon={<FlipVertical2 size={14} />} label="Reflejar Y" />
                </div>
              </Card>
            </>
          )}

          {tab === 'lamp' && (
            <>
              <Card title="Forma">
                <Segmented
                  value={shapeType}
                  onChange={setShapeType}
                  options={[
                    { value: 'cylinder', label: 'Cilindro', icon: <Cylinder size={14} /> },
                    { value: 'box', label: 'Caja', icon: <Box size={14} /> },
                  ]}
                />
                {shapeType === 'cylinder' ? (
                  <Field label="Radio" unit="cm" value={radius} min={1} max={10} step={0.1} onChange={setRadius} />
                ) : (
                  <>
                    <div className="grid-2">
                      <Field label="Ancho" unit="cm" value={boxWidth} min={2} max={30} step={0.5} onChange={setBoxWidth} />
                      <Field label="Profundidad" unit="cm" value={boxDepth} min={2} max={30} step={0.5} onChange={setBoxDepth} />
                    </div>
                    <Field label="Radio de esquina" unit="cm" value={effCorner} min={0} max={maxCorner} step={0.25} onChange={setBoxCornerRadius} />
                  </>
                )}
                <Field label="Altura" unit="cm" value={height} min={2} max={30} step={0.5} onChange={setHeight} />
                <div className="grid-2">
                  <Field label="Grosor de pared" unit="mm" value={effThickness} min={0.8} max={maxThickness} step={0.1} onChange={setThickness} />
                  <Field label="Aro de los extremos" unit="mm" value={effRim} min={0.5} max={20} step={0.5} onChange={setRim} />
                </div>
                {partsEnabled && rim < effRim && (
                  <p className="hint">El aro se amplía para cubrir el labio de la base y la tapa ({lipLength} mm + 1 mm).</p>
                )}
              </Card>

              <Card title="Bombillo">
                <Field label="Distancia a la pared" unit="cm" value={effDistance} min={1} max={maxDistance} step={0.1} onChange={setDistance} />
                <Field label="Radio del bombillo" unit="cm" value={effBulbRadius} min={0.1} max={maxBulbRadius} step={0.1} onChange={setBulbRadius} />
                <div className="note">
                  <Info size={14} />
                  <span>
                    El bombillo queda {bulbDepth.toFixed(1)} cm dentro de la pantalla. Los huecos se orientan hacia él para
                    que el grosor no recorte la sombra. Un LED pequeño da bordes más nítidos.
                  </span>
                </div>
              </Card>
            </>
          )}

          {tab === 'bridges' && (
            <Card title="Puentes">
              <p className="hint">Los puentes sujetan las partes que quedarían sueltas (como el centro de una “O”).</p>
              <div className="chip-grid">
                {BRIDGES.map((b) => (
                  <button key={b.value} type="button" className={`chip${supportType === b.value ? ' on' : ''}`} onClick={() => setSupportType(b.value)}>
                    {supportType === b.value && <Check size={13} />}
                    {b.label}
                  </button>
                ))}
              </div>
              {supportType !== 'none' && (
                <div className="grid-2">
                  <Field label="Grosor" unit="mm" value={supportThickness} min={0.4} max={3} step={0.1} onChange={setSupportThickness} />
                  <Field label="Separación" unit="mm" value={supportSpacing} min={3} max={60} step={1} onChange={setSupportSpacing} />
                </div>
              )}
            </Card>
          )}

          {tab === 'parts' && (
            <>
              <Card title="Piezas encastrables">
                <Switch
                  checked={partsEnabled}
                  onChange={setPartsEnabled}
                  label="Generar base, tapa y poste"
                  description="La base va contra la pared y sostiene el poste hueco del bombillo (por dentro pasa el cable). La tapa cierra el lado de la habitación."
                />
              </Card>
              {partsEnabled && (
                <>
                  <Card title="Ajuste de impresión">
                    <Segmented
                      label="Tipo de impresión"
                      value={nozzle}
                      onChange={(v) => { setNozzle(v); setClearance(NOZZLES[v].clearance); }}
                      options={Object.entries(NOZZLES).map(([value, n]) => ({ value, label: n.label }))}
                    />
                    <Field label="Holgura del encastre" unit="mm" value={clearance} min={0} max={0.6} step={0.05} onChange={setClearance}
                      hint="Espacio entre el labio y la pantalla. Más holgura = encaja más suelto." />
                  </Card>
                  <Card title="Medidas">
                    <Field label="Grosor de la base" unit="mm" value={baseThickness} min={1.5} max={10} step={0.5} onChange={setBaseThickness} />
                    <Field label="Grosor de la tapa" unit="mm" value={capThickness} min={1} max={10} step={0.5} onChange={setCapThickness} />
                    <Field label="Largo del labio" unit="mm" value={lipLength} min={2} max={15} step={0.5} onChange={setLipLength} />
                    <Field label="Diámetro del poste" unit="mm" value={effPostDiameter} min={4} max={maxPostDiameter} step={0.5} onChange={setPostDiameter} />
                    <Field label="Paso de cable" unit="mm" value={effCableDiameter} min={1} max={Math.max(1, effPostDiameter - 1.6)} step={0.5} onChange={setCableDiameter} />
                  </Card>
                </>
              )}
            </>
          )}
        </div>

        {/* Exportación siempre visible */}
        <footer className="export">
          <div className="export-row">
            <select className="select select-compact" value={exportQuality} onChange={(e) => setExportQuality(e.target.value)} title="Calidad del STL">
              {['low', 'medium', 'high', 'ultra'].map((k) => (
                <option key={k} value={k}>{QUALITY[k].label} · {QUALITY[k].cell} mm</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={handleExport} disabled={!!exporting}>
              <Download size={16} /> Exportar pantalla
            </button>
          </div>
          {partsEnabled && (
            <div className="export-parts">
              {['base', 'cap', 'post'].map((k) => (
                <button key={k} className="btn btn-secondary" onClick={() => handlePartExport(k)}>
                  <Download size={14} /> {PART_LABELS[k]}
                </button>
              ))}
            </div>
          )}
        </footer>
      </aside>

      {/* ───────────── Visor 3D ───────────── */}
      <main className="viewport">
        <div className="toolbar toolbar-top">
          <div className="tool-group">
            {partKinds.map((k) => (
              <IconToggle
                key={k}
                active={visibleParts[k]}
                onClick={() => setVisibleParts((v) => ({ ...v, [k]: !v[k] }))}
                icon={visibleParts[k] ? <Eye size={14} /> : <EyeOff size={14} />}
                label={PART_LABELS[k]}
                title={`${visibleParts[k] ? 'Ocultar' : 'Mostrar'} ${PART_LABELS[k].toLowerCase()}`}
              />
            ))}
          </div>
          <div className="tool-group">
            <IconToggle active={showWall} onClick={() => setShowWall((v) => !v)} icon={<Sun size={14} />} label="Luz en la pared" />
            <IconToggle
              active={dragImage}
              onClick={() => setDragImage((v) => !v)}
              icon={<Move size={14} />}
              label="Mover imagen"
              title="Arrastrar la imagen sobre la pared con el mouse"
            />
            {partsEnabled && (
              <IconToggle
                active={exploded}
                onClick={() => setExploded((v) => !v)}
                icon={exploded ? <Shrink size={14} /> : <Expand size={14} />}
                label={exploded ? 'Ensamblar' : 'Separar'}
              />
            )}
          </div>
          <div className="tool-spacer" />
          <div className="tool-group">
            <span className="tool-label">Pared</span>
            <IconToggle active={wallTone === 'dark'} onClick={() => setWallTone('dark')} icon={<Moon size={14} />} title="Pared oscura" />
            <IconToggle active={wallTone === 'light'} onClick={() => setWallTone('light')} icon={<Sun size={14} />} title="Pared clara" />
            <span className="tool-divider" />
            <span className="tool-label">Luz</span>
            {Object.entries(LIGHT_COLORS).map(([k, c]) => (
              <button
                key={k}
                type="button"
                className={`swatch${lightColor === k ? ' on' : ''}`}
                style={{ '--swatch': `rgb(${c.rgb.join(',')})` }}
                onClick={() => setLightColor(k)}
                title={`Luz ${c.label.toLowerCase()}`}
                aria-label={`Luz ${c.label.toLowerCase()}`}
              />
            ))}
          </div>
          <div className="tool-group">
            <IconToggle onClick={() => setCameraKey((k) => k + 1)} icon={<Focus size={14} />} title="Centrar vista" />
          </div>
        </div>

        <div className="status">
          {computing ? <LoaderCircle size={13} className="spin" /> : <span className="status-dot" />}
          {previewError ? (
            <span className="status-error">Error: {previewError}</span>
          ) : preview ? (
            <span>
              Vista previa · {preview.stats.triangles.toLocaleString('es')} triángulos · celda {preview.stats.cell.toFixed(2)} mm · {preview.stats.ms.toFixed(0)} ms
            </span>
          ) : (
            <span>Calculando…</span>
          )}
        </div>

        <Scene
          lampTris={preview?.tris}
          parts={preview?.parts}
          wall={preview?.wall}
          showWall={showWall}
          image={imageData}
          imgOffsetX={imgOffsetX}
          imgOffsetY={imgOffsetY}
          imgScaleX={imgScaleX}
          imgScaleY={imgScaleY}
          imgRotation={imgRotation}
          imgFlipX={imgFlipX}
          imgFlipY={imgFlipY}
          distance={effDistance}
          height={height}
          bulbRadius={effBulbRadius}
          sceneSize={sceneSize}
          viewSize={Math.max(sceneSize, Math.min(60, Math.max(imgScaleX, imgScaleY) / 2))}
          exploded={partsEnabled && exploded}
          visible={partsEnabled ? visibleParts : { ...visibleParts, shade: true }}
          wallTone={wallTone}
          lightFillColor={lightColor}
          resetKey={cameraKey}
          dragImage={dragImage}
          onImageDrag={handleImageDrag}
        />

        {toast && (
          <div className={`toast ${toast.kind}`} role="status">
            {toast.kind === 'ok' ? <Check size={16} /> : <TriangleAlert size={16} />}
            <span>{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Cerrar"><X size={14} /></button>
          </div>
        )}
      </main>

      {imageLoading && (
        <div className="modal-backdrop">
          <div className="modal" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(imageLoading.progress * 100)}>
            <LoaderCircle size={28} className="spin accent" />
            <h2>Cargando la imagen</h2>
            <p>{imageLoading.stage}…</p>
            <div className="progress"><div style={{ width: `${Math.round(imageLoading.progress * 100)}%` }} /></div>
            <span className="progress-label">{Math.round(imageLoading.progress * 100)} %</span>
          </div>
        </div>
      )}

      {exporting && (
        <div className="modal-backdrop">
          <div className="modal">
            <LoaderCircle size={28} className="spin accent" />
            <h2>Generando la pantalla</h2>
            <p>Calidad {QUALITY[exportQuality].label.toLowerCase()} · usando varios núcleos del procesador</p>
            <div className="progress"><div style={{ width: `${Math.round(exporting.progress * 100)}%` }} /></div>
            <span className="progress-label">{Math.round(exporting.progress * 100)} %</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
