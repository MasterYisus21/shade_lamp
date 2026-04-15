import React, { useState } from 'react';
import { Upload, Lightbulb, Calculator, Download, Loader2 } from 'lucide-react';
import Scene from './Scene';
import './index.css';

function App() {
  // Application State
  const [radius, setRadius] = useState(2);
  const [thickness, setThickness] = useState(0.2);
  const [height, setHeight] = useState(7);
  const [distance, setDistance] = useState(5);
  const [bulbRadius, setBulbRadius] = useState(0.5);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imageName, setImageName] = useState('sin_img');
  const [bgColor, setBgColor] = useState('#1e293b');
  const [lightFillColor, setLightFillColor] = useState('yellow');

  // Box Shape State
  const [shapeType, setShapeType] = useState('cylinder'); // 'cylinder' | 'box'
  const [boxWidth, setBoxWidth] = useState(15);
  const [boxDepth, setBoxDepth] = useState(10);
  const [boxCornerRadius, setBoxCornerRadius] = useState(2);

  // Image Transform State
  const [imgOffsetX, setImgOffsetX] = useState(0);
  const [imgOffsetY, setImgOffsetY] = useState(0);
  const [imgScaleX, setImgScaleX] = useState(50);
  const [imgScaleY, setImgScaleY] = useState(50);
  const [imgRotation, setImgRotation] = useState(0);
  const [imgFlipX, setImgFlipX] = useState(false);
  const [imgFlipY, setImgFlipY] = useState(false);

  // Support Grid Configuration
  const [supportType, setSupportType] = useState('none'); // none, vertical, horizontal, diagonal_45, diagonal_-45, grid, diagonal_cross
  const [supportThickness, setSupportThickness] = useState(0.8); // mm (min 0.2, max 0.8)
  const [supportSpacing, setSupportSpacing] = useState(10); // mm

  // Ray-Casting Logic
  const [invertShadow, setInvertShadow] = useState(false);
  const [calculateTrigger, setCalculateTrigger] = useState(0);
  const [validateTrigger, setValidateTrigger] = useState(0);
  const [resetPulse, setResetPulse] = useState(0);

  // STL Export & Loading Logic
  const [exportTrigger, setExportTrigger] = useState(0);
  const [exportQuality, setExportQuality] = useState('medium');
  const [loadingState, setLoadingState] = useState({ isLoading: false, title: '', description: '' });

  const maxBulbRadius = shapeType === 'cylinder'
    ? Math.max(0.1, radius - thickness)
    : Math.max(0.1, Math.min(boxWidth / 2, boxDepth / 2) - thickness);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageName(file.name.substring(0, file.name.lastIndexOf('.')) || file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setUploadedImage(null);
    setImageName('sin_img');
  };

  const handleCalculate = () => {
    setLoadingState({ isLoading: true, title: 'Calculando Geometría', description: 'Calculando proyección de sombras...' });
    setTimeout(() => {
      setCalculateTrigger(t => t + 1);
    }, 150);
  };

  const handleValidate = () => {
    setLoadingState({ isLoading: true, title: 'Validando Sombra', description: 'Trazando luz y sombra real...' });
    setTimeout(() => {
      setValidateTrigger(t => t + 1);
    }, 150);
  };

  const handleReset = () => {
    setResetPulse(p => p + 1);
  };

  const handleExport = () => {
    setLoadingState({ isLoading: true, title: 'Generando Modelo STL...', description: 'Este proceso puede tardar unos segundos. Por favor espera.' });
    // Timeout allows the UI to render the loading overlay before freezing the thread
    setTimeout(() => {
      setExportTrigger(t => t + 1);
    }, 150);
  };

  return (
    <div className="app-container">
      {/* Loading Overlay */}
      {loadingState.isLoading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.9)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif'
        }}>
          <Loader2 size={48} className="lucide-spin" style={{ animation: 'spin 2s linear infinite', marginBottom: '16px', color: '#c084fc' }} />
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          <h2 style={{ margin: '0 0 8px 0' }}>{loadingState.title}</h2>
          <p style={{ color: '#94a3b8', margin: 0 }}>{loadingState.description}</p>
        </div>
      )}

      {/* Sidebar Controls */}
      <div className="sidebar">
        <div className="header">
          <h1>Lámpara de Sombras 3D</h1>
          <p>Generador de Geometría STL</p>
        </div>

        <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-main)', borderBottom: '1px solid var(--border)', paddingBottom: '8px', margin: 0 }}>Parámetros de la Luz y Pared</h3>
          <div className="control-group">
            <label>Color de la Pared (Lienzo)</label>
            <select
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              style={{ background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', width: '100%' }}
            >
              <option value="#1e293b">Oscuro</option>
              <option value="#ffffff">Claro (Blanco)</option>
            </select>
          </div>
          <div className="control-group">
            <label>Color de la Luz (Validación)</label>
            <select
              value={lightFillColor}
              onChange={(e) => setLightFillColor(e.target.value)}
              style={{ background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', width: '100%' }}
            >
              <option value="yellow">Luz Cálida (Amarillento)</option>
              <option value="white">Luz Intensa (Blanco)</option>
              <option value="blue">Luz Fría (Neon Azul)</option>
            </select>
          </div>
          <div className="control-group">
            <label>Radio de la Bombilla (Luz) <span>{bulbRadius.toFixed(2)} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="0.1" max={maxBulbRadius} step="0.1" value={Math.min(bulbRadius, maxBulbRadius)} onChange={(e) => setBulbRadius(parseFloat(e.target.value))} />
              <input type="number" min="0.1" max={maxBulbRadius} step="0.1" value={Math.min(bulbRadius, maxBulbRadius).toFixed(2)} onChange={(e) => setBulbRadius(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
          <div className="control-group">
            <label>Distancia a la Pared de Proyección <span>{distance} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="2" max="20" step="1" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value))} />
              <input type="number" min="2" max="20" step="1" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
        </div>

        <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-main)', borderBottom: '1px solid var(--border)', paddingBottom: '8px', margin: 0 }}>Geometría de la Lámpara</h3>

          <div className="control-group">
            <label>Tipo de Lámpara</label>
            <select
              value={shapeType}
              onChange={(e) => {
                setShapeType(e.target.value);
                if (e.target.value === 'box') {
                  if (bulbRadius > Math.min(boxWidth / 2, boxDepth / 2) - thickness) {
                    setBulbRadius(Math.max(0.1, Math.min(boxWidth / 2, boxDepth / 2) - thickness));
                  }
                } else {
                  if (bulbRadius > radius - thickness) {
                    setBulbRadius(Math.max(0.1, radius - thickness));
                  }
                }
              }}
              style={{ background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', width: '100%' }}
            >
              <option value="cylinder">Cilindro Clásico</option>
              <option value="box">Caja (Rectángulo Redondeado)</option>
            </select>
          </div>

          {shapeType === 'cylinder' ? (
            <div className="control-group">
              <label>Radio del Cilindro <span>{radius} cm</span></label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input type="range" min="1" max="10" step="0.1" value={radius} onChange={(e) => {
                  const newRadius = parseFloat(e.target.value);
                  setRadius(newRadius);
                  if (bulbRadius > newRadius - thickness) setBulbRadius(Math.max(0.1, newRadius - thickness));
                }} />
                <input type="number" min="1" max="10" step="0.1" value={radius} onChange={(e) => {
                  const newRadius = parseFloat(e.target.value);
                  setRadius(newRadius);
                  if (bulbRadius > newRadius - thickness) setBulbRadius(Math.max(0.1, newRadius - thickness));
                }} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
              </div>
            </div>
          ) : (
            <>
              <div className="control-group">
                <label>Ancho de la Caja (X) <span>{boxWidth} cm</span></label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="range" min="2" max="30" step="0.5" value={boxWidth} onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setBoxWidth(val);
                    if (boxCornerRadius > Math.min(val / 2, boxDepth / 2)) setBoxCornerRadius(Math.max(0, Math.min(val / 2, boxDepth / 2)));
                    if (bulbRadius > Math.min(val / 2, boxDepth / 2) - thickness) setBulbRadius(Math.max(0.1, Math.min(val / 2, boxDepth / 2) - thickness));
                  }} />
                  <input type="number" min="2" max="30" step="0.5" value={boxWidth} onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setBoxWidth(val);
                    if (boxCornerRadius > Math.min(val / 2, boxDepth / 2)) setBoxCornerRadius(Math.max(0, Math.min(val / 2, boxDepth / 2)));
                    if (bulbRadius > Math.min(val / 2, boxDepth / 2) - thickness) setBulbRadius(Math.max(0.1, Math.min(val / 2, boxDepth / 2) - thickness));
                  }} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
                </div>
              </div>
              <div className="control-group">
                <label>Profundidad (Y) <span>{boxDepth} cm</span></label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="range" min="2" max="30" step="0.5" value={boxDepth} onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setBoxDepth(val);
                    if (boxCornerRadius > Math.min(boxWidth / 2, val / 2)) setBoxCornerRadius(Math.max(0, Math.min(boxWidth / 2, val / 2)));
                    if (bulbRadius > Math.min(boxWidth / 2, val / 2) - thickness) setBulbRadius(Math.max(0.1, Math.min(boxWidth / 2, val / 2) - thickness));
                  }} />
                  <input type="number" min="2" max="30" step="0.5" value={boxDepth} onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setBoxDepth(val);
                    if (boxCornerRadius > Math.min(boxWidth / 2, val / 2)) setBoxCornerRadius(Math.max(0, Math.min(boxWidth / 2, val / 2)));
                    if (bulbRadius > Math.min(boxWidth / 2, val / 2) - thickness) setBulbRadius(Math.max(0.1, Math.min(boxWidth / 2, val / 2) - thickness));
                  }} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
                </div>
              </div>
              <div className="control-group">
                <label>Radio de Esquina (Bordes) <span>{boxCornerRadius} cm</span></label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="range" min="0" max={Math.min(boxWidth / 2, boxDepth / 2)} step="0.5" value={boxCornerRadius} onChange={(e) => setBoxCornerRadius(parseFloat(e.target.value))} />
                  <input type="number" min="0" max={Math.min(boxWidth / 2, boxDepth / 2)} step="0.5" value={boxCornerRadius} onChange={(e) => setBoxCornerRadius(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
                </div>
              </div>
            </>
          )}
          <div className="control-group">
            <label>Altura del Cilindro <span>{height} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="5" max="20" step="0.5" value={height} onChange={(e) => setHeight(parseFloat(e.target.value))} />
              <input type="number" min="5" max="20" step="0.5" value={height} onChange={(e) => setHeight(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
          <div className="control-group">
            <label>Grosor de la Pared <span>{thickness} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="0.1" max="1" step="0.05" value={thickness} onChange={(e) => {
                const newThickness = parseFloat(e.target.value);
                setThickness(newThickness);
                const boundRad = shapeType === 'cylinder' ? radius : Math.min(boxWidth / 2, boxDepth / 2);
                if (bulbRadius > boundRad - newThickness) setBulbRadius(Math.max(0.1, boundRad - newThickness));
              }} />
              <input type="number" min="0.1" max="1" step="0.05" value={thickness} onChange={(e) => {
                const newThickness = parseFloat(e.target.value);
                setThickness(newThickness);
                const boundRad = shapeType === 'cylinder' ? radius : Math.min(boxWidth / 2, boxDepth / 2);
                if (bulbRadius > boundRad - newThickness) setBulbRadius(Math.max(0.1, boundRad - newThickness));
              }} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
        </div>

        <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-main)', borderBottom: '1px solid var(--border)', paddingBottom: '8px', margin: 0 }}>Controles de Proyección de Imagen</h3>

          <div style={{ display: 'flex', gap: '12px' }}>
            <label className="upload-btn" style={{ flex: 1, padding: '8px', fontSize: '12px' }}>
              <Upload size={14} />
              Subir Imagen
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </label>
            {uploadedImage && (
              <button className="upload-btn" onClick={handleRemoveImage} style={{ flex: 1, background: '#ef4444', padding: '8px', fontSize: '12px' }}>
                Eliminar Imagen
              </button>
            )}
          </div>
          <small style={{ color: 'var(--text-main)', opacity: 0.8, fontSize: '12px', marginTop: '-10px' }}>
            <strong>Recomendación:</strong> Usa imágenes <strong>SVG</strong> para obtener cortes con curvas perfectas de máxima resolución en tu modelo 3D.
          </small>

          <div className="control-group">
            <label>Escala Horizontal (X) <span>{imgScaleX} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="1" max="100" step="1" value={imgScaleX} onChange={(e) => setImgScaleX(parseFloat(e.target.value))} />
              <input type="number" min="1" max="100" step="1" value={imgScaleX} onChange={(e) => setImgScaleX(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
          <div className="control-group">
            <label>Escala Vertical (Y) <span>{imgScaleY} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="1" max="100" step="1" value={imgScaleY} onChange={(e) => setImgScaleY(parseFloat(e.target.value))} />
              <input type="number" min="1" max="100" step="1" value={imgScaleY} onChange={(e) => setImgScaleY(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
          <div className="control-group">
            <label>Desplazamiento X <span>{imgOffsetX} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="-50" max="50" step="0.5" value={imgOffsetX} onChange={(e) => setImgOffsetX(parseFloat(e.target.value))} />
              <input type="number" min="-50" max="50" step="0.5" value={imgOffsetX} onChange={(e) => setImgOffsetX(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
          <div className="control-group">
            <label>Desplazamiento Y <span>{imgOffsetY} cm</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="-50" max="50" step="0.5" value={imgOffsetY} onChange={(e) => setImgOffsetY(parseFloat(e.target.value))} />
              <input type="number" min="-50" max="50" step="0.5" value={imgOffsetY} onChange={(e) => setImgOffsetY(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>
          <div className="control-group">
            <label>Rotación <span>{imgRotation}°</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="range" min="-180" max="180" step="1" value={imgRotation} onChange={(e) => setImgRotation(parseFloat(e.target.value))} />
              <input type="number" min="-180" max="180" step="1" value={imgRotation} onChange={(e) => setImgRotation(parseFloat(e.target.value))} style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={imgFlipX} onChange={(e) => setImgFlipX(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
              Reflejar X
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={imgFlipY} onChange={(e) => setImgFlipY(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
              Reflejar Y
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px', marginTop: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={invertShadow} onChange={(e) => setInvertShadow(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
            Invertir Sombra (Huecos vs Sólidos)
          </label>
        </div>

        <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-main)', borderBottom: '1px solid var(--border)', paddingBottom: '8px', margin: 0 }}>Puentes (Soportes Físicos)</h3>

          <div className="control-group">
            <label>Tipo de Puente</label>
            <select
              value={supportType}
              onChange={(e) => setSupportType(e.target.value)}
              style={{ background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', width: '100%' }}
            >
              <option value="none">Sin Puentes</option>
              <option value="vertical">Vertical (90°)</option>
              <option value="horizontal">Horizontal (0°)</option>
              <option value="diagonal_45">Diagonal (+45°)</option>
              <option value="diagonal_neg45">Diagonal (-45°)</option>
              <option value="grid">Cuadrícula Ortogonal</option>
              <option value="diagonal_cross">Malla Cruzada</option>
            </select>
          </div>

          <div className="control-group">
            <label>Grosor del Puente <span>{supportThickness} mm</span></label>
            <input type="range" min="0.6" max="1.6" step="0.2" value={supportThickness} onChange={(e) => setSupportThickness(parseFloat(e.target.value))} />
          </div>

          <div className="control-group">
            <label>Espaciado entre puentes <span>{supportSpacing} mm</span></label>
            <input type="range" min="2" max="50" step="1" value={supportSpacing} onChange={(e) => setSupportSpacing(parseFloat(e.target.value))} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
          <button className="upload-btn" onClick={handleCalculate} style={{ background: '#9b51e0' }}>
            <Calculator size={18} />
            1. Generar Vista Previa (Recortar Matriz)
          </button>

          <button className="upload-btn" onClick={handleValidate} style={{ background: '#2563eb' }}>
            <Lightbulb size={18} />
            2. Trazar Sombra Real (Contorno Azul)
          </button>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <select
              value={exportQuality}
              onChange={(e) => setExportQuality(e.target.value)}
              style={{ background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '0 8px' }}
            >
              <option value="low">Calidad: Baja (256×128 celdas)</option>
              <option value="medium">Calidad: Media (512×256 celdas)</option>
              <option value="high">Calidad: Alta (1024×512 celdas)</option>
              <option value="ultra">Calidad: Ultra (2048×1024 celdas)</option>
            </select>
            <button className="upload-btn" onClick={handleExport} style={{ background: '#10b981', flex: 1 }}>
              <Download size={18} />
              3. Descargar STL
            </button>
          </div>

          <button className="upload-btn" onClick={handleReset} style={{ background: '#475569', marginTop: '16px' }}>
            Restablecer Memoria (Borrar Previsualizaciones)
          </button>
        </div>

        <div className="info-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--text-main)' }}>
            <Lightbulb size={16} color="var(--accent)" />
            <strong>Restricciones Lógicas (Geometría)</strong>
          </div>
          El origen de la luz se encuentra en [0,0,0]. La pared de proyección en Z = {distance} cm.
          El bombillo (radio interno máximo) debe ser más pequeño que el interior de la lámpara.
        </div>
      </div>

      {/* Main Viewport for Three.js */}
      <div className="viewport">
        <Scene
          radius={radius}
          shapeType={shapeType}
          boxWidth={boxWidth}
          boxDepth={boxDepth}
          boxCornerRadius={boxCornerRadius}
          thickness={thickness}
          height={height}
          distance={distance}
          bulbRadius={Math.min(bulbRadius, maxBulbRadius)}
          uploadedImage={uploadedImage}
          imageName={imageName}
          imgOffsetX={imgOffsetX}
          imgOffsetY={imgOffsetY}
          imgScaleX={imgScaleX}
          imgScaleY={imgScaleY}
          imgRotation={imgRotation}
          imgFlipX={imgFlipX}
          imgFlipY={imgFlipY}
          invertShadow={invertShadow}
          supportType={supportType}
          supportThickness={supportThickness}
          supportSpacing={supportSpacing}
          calculateTrigger={calculateTrigger}
          validateTrigger={validateTrigger}
          resetPulse={resetPulse}
          exportTrigger={exportTrigger}
          exportQuality={exportQuality}
          onCalculateComplete={() => setLoadingState({ isLoading: false, title: '', description: '' })}
          onValidateComplete={() => setLoadingState({ isLoading: false, title: '', description: '' })}
          onExportComplete={() => setLoadingState({ isLoading: false, title: '', description: '' })}
          bgColor={bgColor}
          lightFillColor={lightFillColor}
        />
      </div>
    </div>
  );
}

export default App;
