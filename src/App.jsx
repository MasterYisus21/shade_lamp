import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Upload, Lightbulb, Download, Loader2, Eye, EyeOff } from 'lucide-react';
import Scene from './Scene';
import { createPreviewEngine, exportStl, exportPartStl } from './engine/client';
import { loadImageLuminance, defaultImage } from './engine/image';
import { QUALITY } from './core/engine';
import { DEFAULT_PARTS } from './core/parts';
import './index.css';

// Holgura del encastre según el tipo de impresión (mm)
const NOZZLES = {
  '0.4': { label: 'FDM · boquilla 0.4 mm', clearance: 0.2 },
  '0.2': { label: 'FDM · boquilla 0.2 mm', clearance: 0.15 },
  resin: { label: 'Resina', clearance: 0.1 },
};

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

function Slider({ label, unit, value, min, max, step, onChange, digits }) {
  const shown = digits !== undefined ? Number(value).toFixed(digits) : value;
  const handle = (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div className="control-group">
      <label>{label} <span>{shown} {unit}</span></label>
      <div className="slider-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={handle} />
        <input type="number" min={min} max={max} step={step} value={shown} onChange={handle} />
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

const QUALITY_OPTIONS = ['low', 'medium', 'high', 'ultra'];

function App() {
  // Luz y pared (cm)
  const [bgColor, setBgColor] = useState('#1e293b');
  const [lightFillColor, setLightFillColor] = useState('yellow');
  const [bulbRadius, setBulbRadius] = useState(1);
  const [distance, setDistance] = useState(7);

  // Geometría (cm, grosores en mm)
  const [shapeType, setShapeType] = useState('cylinder');
  const [radius, setRadius] = useState(3);
  const [boxWidth, setBoxWidth] = useState(15);
  const [boxDepth, setBoxDepth] = useState(10);
  const [boxCornerRadius, setBoxCornerRadius] = useState(2);
  const [height, setHeight] = useState(10);
  const [thickness, setThickness] = useState(2);
  const [rim, setRim] = useState(2);

  // Imagen (cm)
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imageName, setImageName] = useState('sin_img');
  const [imageData, setImageData] = useState(() => defaultImage());
  const [imgOffsetX, setImgOffsetX] = useState(0);
  const [imgOffsetY, setImgOffsetY] = useState(0);
  const [imgScaleX, setImgScaleX] = useState(20);
  const [imgScaleY, setImgScaleY] = useState(20);
  const [imgRotation, setImgRotation] = useState(0);
  const [imgFlipX, setImgFlipX] = useState(false);
  const [imgFlipY, setImgFlipY] = useState(false);
  const [invertShadow, setInvertShadow] = useState(false);

  // Puentes (mm)
  const [supportType, setSupportType] = useState('none');
  const [supportThickness, setSupportThickness] = useState(0.8);
  const [supportSpacing, setSupportSpacing] = useState(20);

  // Impresora y piezas (mm)
  const [nozzle, setNozzle] = useState('0.4');
  const [partsEnabled, setPartsEnabled] = useState(true);
  const [baseThickness, setBaseThickness] = useState(DEFAULT_PARTS.baseThickness);
  const [capThickness, setCapThickness] = useState(DEFAULT_PARTS.capThickness);
  const [lipLength, setLipLength] = useState(DEFAULT_PARTS.lipLength);
  const [clearance, setClearance] = useState(NOZZLES['0.4'].clearance);
  const [postDiameter, setPostDiameter] = useState(DEFAULT_PARTS.postOuterRadius * 2);
  const [cableDiameter, setCableDiameter] = useState(DEFAULT_PARTS.cableRadius * 2);

  // Vista previa y exportación
  const [showWall, setShowWall] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [exportQuality, setExportQuality] = useState('high');
  const [exportState, setExportState] = useState({ running: false, progress: 0, result: null, error: null });

  // Límites físicos
  const innerHalf = shapeType === 'cylinder' ? radius : Math.min(boxWidth, boxDepth) / 2;
  const maxBulbRadius = Math.max(0.1, innerHalf - thickness / 10);
  const effBulbRadius = Math.min(bulbRadius, maxBulbRadius);
  const gapCm = partsEnabled ? baseThickness / 10 : 0; // la base separa la pantalla de la pared
  const maxDistance = Math.max(1, height - 0.5 + gapCm); // el bombillo va dentro de la pantalla
  const effDistance = Math.min(distance, maxDistance);
  const maxCorner = Math.min(boxWidth, boxDepth) / 2;
  const effCorner = Math.min(boxCornerRadius, maxCorner);
  const maxThickness = Math.min(10, innerHalf * 10 * 0.5);
  const effThickness = Math.min(thickness, maxThickness);
  // El labio de la base y la tapa entra en la pantalla: esa zona debe ser sólida
  const effRim = partsEnabled ? Math.max(rim, lipLength + 1) : rim;
  const maxPostDiameter = Math.max(4, Math.floor((innerHalf * 10 - effThickness) * 2 * 0.5));
  const effPostDiameter = Math.min(postDiameter, maxPostDiameter);
  const effCableDiameter = Math.min(cableDiameter, effPostDiameter - 1.6);

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
      (msg) => { setPreview(msg); setPreviewError(null); },
      (message) => setPreviewError(message),
    );
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  useEffect(() => {
    engineRef.current?.setImage(imageData);
  }, [imageData]);

  useEffect(() => {
    engineRef.current?.request(engineParams, showWall);
  }, [engineParams, imageData, showWall]);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageName(file.name.substring(0, file.name.lastIndexOf('.')) || file.name);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = await loadImageLuminance(event.target.result);
        setUploadedImage(event.target.result);
        setImageData(data);
      } catch (err) {
        alert(err.message);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveImage = () => {
    setUploadedImage(null);
    setImageName('sin_img');
    setImageData(defaultImage());
  };

  const handleExport = async () => {
    setExportState({ running: true, progress: 0, result: null, error: null });
    try {
      const result = await exportStl(engineParams, imageData, exportQuality, (p) =>
        setExportState((s) => ({ ...s, progress: p })),
      );
      const name = `lamp_${imageName}_pantalla_${exportQuality}.stl`;
      downloadBuffer(result.buffer, name);
      setExportState({ running: false, progress: 1, result: { ...result, name }, error: null });
    } catch (err) {
      console.error('Error generando STL:', err);
      setExportState({ running: false, progress: 0, result: null, error: err.message });
    }
  };

  const PART_NAMES = { base: 'base', cap: 'tapa', post: 'poste' };
  const handlePartExport = (kind) => {
    downloadBuffer(exportPartStl(engineParams, kind), `lamp_${imageName}_${PART_NAMES[kind]}.stl`);
  };

  const sceneSize =Math.max(height, shapeType === 'cylinder' ? radius : Math.max(boxWidth, boxDepth) / 2);

  return (
    <div className="app-container">
      {exportState.running && (
        <div className="overlay">
          <Loader2 size={48} className="spin" />
          <h2>Generando modelo STL…</h2>
          <p>Calidad {QUALITY[exportQuality].label.toLowerCase()} · usando varios núcleos del procesador</p>
          <div className="progress"><div style={{ width: `${Math.round(exportState.progress * 100)}%` }} /></div>
        </div>
      )}

      <div className="sidebar">
        <div className="header">
          <h1>Lámpara de Sombras 3D</h1>
          <p>Generador de Geometría STL</p>
        </div>

        <Section title="Luz y pared">
          <div className="control-group">
            <label>Color de la pared (solo visual)</label>
            <select value={bgColor} onChange={(e) => setBgColor(e.target.value)}>
              <option value="#1e293b">Oscuro</option>
              <option value="#ffffff">Claro (blanco)</option>
            </select>
          </div>
          <div className="control-group">
            <label>Color de la luz (solo visual)</label>
            <select value={lightFillColor} onChange={(e) => setLightFillColor(e.target.value)}>
              <option value="yellow">Luz cálida (amarillenta)</option>
              <option value="white">Luz intensa (blanca)</option>
              <option value="blue">Luz fría (neón azul)</option>
            </select>
          </div>
          <Slider label="Radio del bombillo" unit="cm" value={effBulbRadius} min={0.1} max={maxBulbRadius} step={0.1} digits={1} onChange={setBulbRadius} />
          <Slider label="Distancia bombillo → pared" unit="cm" value={effDistance} min={1} max={maxDistance} step={0.5} onChange={setDistance} />
        </Section>

        <Section title="Geometría de la lámpara">
          <div className="control-group">
            <label>Tipo de lámpara</label>
            <select value={shapeType} onChange={(e) => setShapeType(e.target.value)}>
              <option value="cylinder">Cilindro</option>
              <option value="box">Caja (rectángulo redondeado)</option>
            </select>
          </div>
          {shapeType === 'cylinder' ? (
            <Slider label="Radio del cilindro" unit="cm" value={radius} min={1} max={10} step={0.1} onChange={setRadius} />
          ) : (
            <>
              <Slider label="Ancho (X)" unit="cm" value={boxWidth} min={2} max={30} step={0.5} onChange={setBoxWidth} />
              <Slider label="Profundidad (Y)" unit="cm" value={boxDepth} min={2} max={30} step={0.5} onChange={setBoxDepth} />
              <Slider label="Radio de esquina" unit="cm" value={effCorner} min={0} max={maxCorner} step={0.25} onChange={setBoxCornerRadius} />
            </>
          )}
          <Slider label="Altura (desde la pared)" unit="cm" value={height} min={2} max={30} step={0.5} onChange={setHeight} />
          <Slider label="Grosor de la pared" unit="mm" value={effThickness} min={0.8} max={maxThickness} step={0.1} digits={1} onChange={setThickness} />
          <Slider label="Aro sólido en los extremos" unit="mm" value={effRim} min={0.5} max={20} step={0.5} onChange={setRim} />
          {partsEnabled && rim < effRim && (
            <small className="hint">El aro se amplía para cubrir el labio de la base y la tapa ({lipLength} mm + 1).</small>
          )}
        </Section>

        <Section title="Base, tapa y poste">
          <div className="checks">
            <label>
              <input type="checkbox" checked={partsEnabled} onChange={(e) => setPartsEnabled(e.target.checked)} />
              Generar base, tapa y poste encastrables
            </label>
          </div>
          {partsEnabled && (
            <>
              <small className="hint">
                La base va contra la pared y sostiene el poste hueco del bombillo (pasa el cable). La tapa cierra el lado
                de la habitación. Ambas encajan dentro de la pantalla con un labio.
              </small>
              <div className="control-group">
                <label>Tipo de impresión</label>
                <select value={nozzle} onChange={(e) => { setNozzle(e.target.value); setClearance(NOZZLES[e.target.value].clearance); }}>
                  {Object.entries(NOZZLES).map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}
                </select>
              </div>
              <Slider label="Holgura del encastre" unit="mm" value={clearance} min={0} max={0.6} step={0.05} digits={2} onChange={setClearance} />
              <Slider label="Grosor de la base" unit="mm" value={baseThickness} min={1.5} max={10} step={0.5} onChange={setBaseThickness} />
              <Slider label="Grosor de la tapa" unit="mm" value={capThickness} min={1} max={10} step={0.5} onChange={setCapThickness} />
              <Slider label="Largo del labio" unit="mm" value={lipLength} min={2} max={15} step={0.5} onChange={setLipLength} />
              <Slider label="Diámetro del poste" unit="mm" value={effPostDiameter} min={4} max={maxPostDiameter} step={0.5} onChange={setPostDiameter} />
              <Slider label="Diámetro del paso de cable" unit="mm" value={effCableDiameter} min={1} max={Math.max(1, effPostDiameter - 1.6)} step={0.5} onChange={setCableDiameter} />
            </>
          )}
        </Section>

        <Section title="Imagen proyectada">
          <div className="button-row">
            <label className="btn btn-small">
              <Upload size={14} /> Subir imagen
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </label>
            {uploadedImage && (
              <button className="btn btn-small btn-danger" onClick={handleRemoveImage}>Quitar imagen</button>
            )}
          </div>
          <small className="hint">
            Imágenes en blanco y negro. Con <strong>SVG</strong> los bordes salen más limpios. Lo transparente cuenta como blanco.
          </small>
          <Slider label="Ancho en la pared" unit="cm" value={imgScaleX} min={1} max={150} step={1} onChange={setImgScaleX} />
          <Slider label="Alto en la pared" unit="cm" value={imgScaleY} min={1} max={150} step={1} onChange={setImgScaleY} />
          <Slider label="Desplazamiento X" unit="cm" value={imgOffsetX} min={-70} max={70} step={0.5} onChange={setImgOffsetX} />
          <Slider label="Desplazamiento Y" unit="cm" value={imgOffsetY} min={-70} max={70} step={0.5} onChange={setImgOffsetY} />
          <Slider label="Rotación" unit="°" value={imgRotation} min={-180} max={180} step={1} onChange={setImgRotation} />
          <div className="checks">
            <label><input type="checkbox" checked={imgFlipX} onChange={(e) => setImgFlipX(e.target.checked)} /> Reflejar X</label>
            <label><input type="checkbox" checked={imgFlipY} onChange={(e) => setImgFlipY(e.target.checked)} /> Reflejar Y</label>
          </div>
          <div className="control-group">
            <label>Lo negro de la imagen será</label>
            <select value={invertShadow ? 'shadow' : 'light'} onChange={(e) => setInvertShadow(e.target.value === 'shadow')}>
              <option value="light">Luz en la pared (huecos)</option>
              <option value="shadow">Sombra en la pared (material)</option>
            </select>
          </div>
        </Section>

        <Section title="Puentes (soportes)">
          <div className="control-group">
            <label>Tipo de puente</label>
            <select value={supportType} onChange={(e) => setSupportType(e.target.value)}>
              <option value="none">Sin puentes</option>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
              <option value="diagonal_45">Diagonal (+45°)</option>
              <option value="diagonal_neg45">Diagonal (−45°)</option>
              <option value="grid">Cuadrícula</option>
              <option value="diagonal_cross">Malla cruzada</option>
            </select>
          </div>
          {supportType !== 'none' && (
            <>
              <Slider label="Grosor del puente" unit="mm" value={supportThickness} min={0.4} max={3} step={0.1} digits={1} onChange={setSupportThickness} />
              <Slider label="Separación entre puentes" unit="mm" value={supportSpacing} min={3} max={60} step={1} onChange={setSupportSpacing} />
            </>
          )}
        </Section>

        <Section title="Exportar">
          <div className="control-group">
            <label>Calidad del STL</label>
            <select value={exportQuality} onChange={(e) => setExportQuality(e.target.value)}>
              {QUALITY_OPTIONS.map((k) => (
                <option key={k} value={k}>{QUALITY[k].label} (celda {QUALITY[k].cell} mm)</option>
              ))}
            </select>
          </div>
          <button className="btn btn-export" onClick={handleExport} disabled={exportState.running}>
            <Download size={18} /> Descargar pantalla (STL)
          </button>
          {partsEnabled && (
            <div className="button-row">
              <button className="btn btn-small btn-export" onClick={() => handlePartExport('base')}><Download size={14} /> Base</button>
              <button className="btn btn-small btn-export" onClick={() => handlePartExport('cap')}><Download size={14} /> Tapa</button>
              <button className="btn btn-small btn-export" onClick={() => handlePartExport('post')}><Download size={14} /> Poste</button>
            </div>
          )}
          {exportState.result && (
            <small className="hint">
              {exportState.result.name}: {exportState.result.triangles.toLocaleString('es')} triángulos,{' '}
              {(exportState.result.buffer.byteLength / 1e6).toFixed(1)} MB, {(exportState.result.ms / 1000).toFixed(1)} s
              {exportState.result.coarsened && ` · celda ampliada a ${exportState.result.cell.toFixed(3)} mm por el tamaño de la lámpara`}
            </small>
          )}
          {exportState.error && <small className="hint error">Error: {exportState.error}</small>}
        </Section>

        <div className="info-box">
          <div className="info-title">
            <Lightbulb size={16} color="var(--accent)" />
            <strong>Cómo funciona</strong>
          </div>
          El bombillo está en el origen y la pared a {effDistance} cm.
          {partsEnabled ? ` La base mide ${baseThickness} mm y sobre ella va la pantalla de ${height} cm,` : ` La pantalla sale de la pared ${height} cm,`}
          {' '}así que el bombillo queda {(height + gapCm - effDistance).toFixed(1)} cm dentro de ella. Los huecos se
          orientan hacia el bombillo para que el grosor no recorte la sombra.
        </div>
      </div>

      <div className="viewport">
        <div className="viewport-bar">
          <button className="btn btn-small btn-ghost" onClick={() => setShowWall((v) => !v)}>
            {showWall ? <EyeOff size={14} /> : <Eye size={14} />}
            {showWall ? 'Ocultar luz proyectada' : 'Mostrar luz proyectada'}
          </button>
          {partsEnabled && (
            <button className="btn btn-small btn-ghost" onClick={() => setExploded((v) => !v)}>
              {exploded ? 'Vista ensamblada' : 'Vista separada'}
            </button>
          )}
          {preview && (
            <span className="badge">
              Vista previa: {preview.stats.triangles.toLocaleString('es')} triángulos · celda {preview.stats.cell.toFixed(2)} mm · {preview.stats.ms.toFixed(0)} ms
            </span>
          )}
          {previewError && <span className="badge error">Error: {previewError}</span>}
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
          gap={gapCm}
          exploded={partsEnabled && exploded}
          height={height}
          bulbRadius={effBulbRadius}
          sceneSize={sceneSize}
          bgColor={bgColor}
          lightFillColor={lightFillColor}
        />
      </div>
    </div>
  );
}

export default App;
