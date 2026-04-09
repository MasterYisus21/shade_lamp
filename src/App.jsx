import React, { useState } from 'react';
import { Upload, Lightbulb, Calculator, Download, Loader2 } from 'lucide-react';
import Scene from './Scene';
import './index.css';

function App() {
  // Application State
  const [radius, setRadius] = useState(3);
  const [thickness, setThickness] = useState(0.2);
  const [height, setHeight] = useState(10);
  const [distance, setDistance] = useState(7);
  const [bulbRadius, setBulbRadius] = useState(1);
  const [uploadedImage, setUploadedImage] = useState(null);

  // Image Transform State
  const [imgOffsetX, setImgOffsetX] = useState(0);
  const [imgOffsetY, setImgOffsetY] = useState(0);
  const [imgScaleX, setImgScaleX] = useState(20);
  const [imgScaleY, setImgScaleY] = useState(20);
  const [imgRotation, setImgRotation] = useState(0);
  const [imgFlipX, setImgFlipX] = useState(false);
  const [imgFlipY, setImgFlipY] = useState(false);

  // Support Grid Configuration
  const [supportType, setSupportType] = useState('grid'); // none, vertical, horizontal, diagonal_45, diagonal_-45, grid, diagonal_cross
  const [supportThickness, setSupportThickness] = useState(0.4); // mm (min 0.2, max 0.8)
  const [supportSpacing, setSupportSpacing] = useState(20); // mm

  // Ray-Casting Logic
  const [invertShadow, setInvertShadow] = useState(false);
  const [calculateTrigger, setCalculateTrigger] = useState(0);
  const [validateTrigger, setValidateTrigger] = useState(0);
  const [resetPulse, setResetPulse] = useState(0);

  // STL Export Logic
  const [exportTrigger, setExportTrigger] = useState(0);
  const [exportQuality, setExportQuality] = useState('medium');
  const [isExporting, setIsExporting] = useState(false);

  // Constraint: inner radius
  const maxBulbRadius = Math.max(0.1, radius - thickness);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setUploadedImage(null);
  };

  const handleCalculate = () => {
    setCalculateTrigger(t => t + 1);
  };

  const handleValidate = () => {
    setValidateTrigger(t => t + 1);
  };

  const handleReset = () => {
    setResetPulse(p => p + 1);
  };

  const handleExport = () => {
    setIsExporting(true);
    // Timeout allows the UI to render the loading overlay before freezing the thread
    setTimeout(() => {
      setExportTrigger(t => t + 1);
    }, 150);
  };

  return (
    <div className="app-container">
      {/* Loading Overlay */}
      {isExporting && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.9)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif'
        }}>
          <Loader2 size={48} className="lucide-spin" style={{ animation: 'spin 2s linear infinite', marginBottom: '16px', color: '#c084fc' }} />
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          <h2 style={{ margin: '0 0 8px 0' }}>Generando Modelo STL...</h2>
          <p style={{ color: '#94a3b8', margin: 0 }}>Este proceso puede tardar unos segundos. Por favor espera.</p>
        </div>
      )}

      {/* Sidebar Controls */}
      <div className="sidebar">
        <div className="header">
          <h1>Shadow Lamp</h1>
          <p>Projection Geometry MVP</p>
        </div>

        <div className="control-group">
          <label>
            Cylinder Radius
            <span>{radius} cm</span>
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="range"
              min="1" max="10" step="0.1"
              value={radius}
              onChange={(e) => {
                const newRadius = parseFloat(e.target.value);
                setRadius(newRadius);
                if (bulbRadius > newRadius - thickness) {
                  setBulbRadius(Math.max(0.1, newRadius - thickness));
                }
              }}
            />
            <input
              type="number"
              min="1" max="10" step="0.1"
              value={radius}
              onChange={(e) => {
                const newRadius = parseFloat(e.target.value);
                setRadius(newRadius);
                if (bulbRadius > newRadius - thickness) {
                  setBulbRadius(Math.max(0.1, newRadius - thickness));
                }
              }}
              style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </div>
        </div>

        <div className="control-group">
          <label>
            Bulb Radius (Light Source)
            <span>{bulbRadius.toFixed(2)} cm</span>
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="range"
              min="0.1" max={maxBulbRadius} step="0.1"
              value={Math.min(bulbRadius, maxBulbRadius)}
              onChange={(e) => setBulbRadius(parseFloat(e.target.value))}
            />
            <input
              type="number"
              min="0.1" max={maxBulbRadius} step="0.1"
              value={Math.min(bulbRadius, maxBulbRadius).toFixed(2)}
              onChange={(e) => setBulbRadius(parseFloat(e.target.value))}
              style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </div>
        </div>

        <div className="control-group">
          <label>
            Cylinder Height
            <span>{height} cm</span>
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="range"
              min="5" max="20" step="0.5"
              value={height}
              onChange={(e) => setHeight(parseFloat(e.target.value))}
            />
            <input
              type="number"
              min="5" max="20" step="0.5"
              value={height}
              onChange={(e) => setHeight(parseFloat(e.target.value))}
              style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </div>
        </div>

        <div className="control-group">
          <label>
            Cylinder Wall Thickness
            <span>{thickness} cm</span>
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="range"
              min="0.1" max="1" step="0.05"
              value={thickness}
              onChange={(e) => {
                const newThickness = parseFloat(e.target.value);
                setThickness(newThickness);
                if (bulbRadius > radius - newThickness) {
                  setBulbRadius(Math.max(0.1, radius - newThickness));
                }
              }}
            />
            <input
              type="number"
              min="0.1" max="1" step="0.05"
              value={thickness}
              onChange={(e) => {
                const newThickness = parseFloat(e.target.value);
                setThickness(newThickness);
                if (bulbRadius > radius - newThickness) {
                  setBulbRadius(Math.max(0.1, radius - newThickness));
                }
              }}
              style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </div>
        </div>

        <div className="control-group">
          <label>
            Bulb to Wall Distance
            <span>{distance} cm</span>
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="range"
              min="2" max="20" step="1"
              value={distance}
              onChange={(e) => setDistance(parseFloat(e.target.value))}
            />
            <input
              type="number"
              min="2" max="20" step="1"
              value={distance}
              onChange={(e) => setDistance(parseFloat(e.target.value))}
              style={{ width: '60px', padding: '4px', background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </div>
        </div>

        <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--text-main)', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>Image Projection Controls</h3>

          <div style={{ display: 'flex', gap: '12px' }}>
            <label className="upload-btn" style={{ flex: 1, padding: '8px', fontSize: '12px' }}>
              <Upload size={14} />
              Upload Image
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </label>
            {uploadedImage && (
              <button className="upload-btn" onClick={handleRemoveImage} style={{ flex: 1, background: '#ef4444', padding: '8px', fontSize: '12px' }}>
                Remove Image
              </button>
            )}
          </div>

          <div className="control-group">
            <label>Width Scale (X) <span>{imgScaleX} cm</span></label>
            <input type="range" min="1" max="100" step="1" value={imgScaleX} onChange={(e) => setImgScaleX(parseFloat(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Height Scale (Y) <span>{imgScaleY} cm</span></label>
            <input type="range" min="1" max="100" step="1" value={imgScaleY} onChange={(e) => setImgScaleY(parseFloat(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Offset X <span>{imgOffsetX} cm</span></label>
            <input type="range" min="-50" max="50" step="1" value={imgOffsetX} onChange={(e) => setImgOffsetX(parseFloat(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Offset Y <span>{imgOffsetY} cm</span></label>
            <input type="range" min="-50" max="50" step="1" value={imgOffsetY} onChange={(e) => setImgOffsetY(parseFloat(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Rotation <span>{imgRotation}°</span></label>
            <input type="range" min="-180" max="180" step="1" value={imgRotation} onChange={(e) => setImgRotation(parseFloat(e.target.value))} />
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={imgFlipX} onChange={(e) => setImgFlipX(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
              Flip X
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={imgFlipY} onChange={(e) => setImgFlipY(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
              Flip Y
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px', marginTop: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={invertShadow} onChange={(e) => setInvertShadow(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
            Invert Shadow (Holes vs Solid)
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
            1. Calculate Holes (Mesh/Grid)
          </button>

          <button className="upload-btn" onClick={handleValidate} style={{ background: '#2563eb' }}>
            <Lightbulb size={18} />
            2. Trace Real Shadow (Blue Contour)
          </button>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <select
              value={exportQuality}
              onChange={(e) => setExportQuality(e.target.value)}
              style={{ background: 'var(--input-bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '0 8px' }}
            >
              <option value="low">Calidad: Baja (256x128)</option>
              <option value="medium">Calidad: Media (512x256)</option>
              <option value="high">Calidad: Alta (1024x512)</option>
            </select>
            <button className="upload-btn" onClick={handleExport} style={{ background: '#10b981', flex: 1 }}>
              <Download size={18} />
              3. Exportar STL
            </button>
          </div>

          <button className="upload-btn" onClick={handleReset} style={{ background: '#475569', marginTop: '16px' }}>
            Reset Result Geometry
          </button>
        </div>

        <div className="info-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--text-main)' }}>
            <Lightbulb size={16} color="var(--accent)" />
            <strong>Geometry Constraints</strong>
          </div>
          The light origin is placed at (0,0,0). The projection wall is at Z = {distance}.
          The cylinder surrounds the origin with a radius of {radius}.
        </div>
      </div>

      {/* Main Viewport for Three.js */}
      <div className="viewport">
        <Scene
          radius={radius}
          thickness={thickness}
          height={height}
          distance={distance}
          bulbRadius={Math.min(bulbRadius, maxBulbRadius)}
          uploadedImage={uploadedImage}
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
          onExportComplete={() => setIsExporting(false)}
        />
      </div>
    </div>
  );
}

export default App;
