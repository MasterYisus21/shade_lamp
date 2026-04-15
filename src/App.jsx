import React, { useState, useCallback } from 'react';
import { Upload, Lightbulb, Calculator, Download, Loader2, Settings, Box, Image as ImageIcon, Settings2, Trash2, LightbulbOff, Layers } from 'lucide-react';
import Scene from './Scene';
import './index.css';

function App() {
  // GUI State
  const [activeTab, setActiveTab] = useState('global'); // 'global', 'lamp', 'image', 'export'

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
  const [supportType, setSupportType] = useState('none');
  const [supportThickness, setSupportThickness] = useState(0.8);
  const [supportSpacing, setSupportSpacing] = useState(10);

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
        setActiveTab('image'); // Auto-switch to image settings
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
    setTimeout(() => setCalculateTrigger(t => t + 1), 150);
  };

  const handleValidate = () => {
    setLoadingState({ isLoading: true, title: 'Validando Sombra', description: 'Trazando luz y sombra real...' });
    setTimeout(() => setValidateTrigger(t => t + 1), 150);
  };

  const handleReset = () => {
    setResetPulse(p => p + 1);
  };

  const handleExport = () => {
    setLoadingState({ isLoading: true, title: 'Generando Modelo STL...', description: 'Este proceso puede tardar unos segundos. Por favor espera.' });
    setTimeout(() => setExportTrigger(t => t + 1), 150);
  };

  const [hideValidationMap, setHideValidationMap] = useState(false);

  // Callback to sync transform controls back to state
  const handleImageTransformChange = useCallback(({ x, y, scaleX, scaleY }) => {
    if (x !== undefined) setImgOffsetX(parseFloat(x.toFixed(2)));
    if (y !== undefined) setImgOffsetY(parseFloat(y.toFixed(2)));
    if (scaleX !== undefined) setImgScaleX(parseFloat(scaleX.toFixed(2)));
    // Note: TransformControls mostly scales uniformly unless you tweak it, but we support both
    if (scaleY !== undefined) setImgScaleY(parseFloat(scaleY.toFixed(2)));
  }, []);

  return (
    <div className="app-container">
      {/* Loading Overlay */}
      {loadingState.isLoading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(10, 15, 26, 0.9)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif'
        }}>
          <Loader2 size={48} className="lucide-spin" style={{ animation: 'spin 2s linear infinite', marginBottom: '16px', color: '#c084fc' }} />
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '1.5rem', fontWeight: '600' }}>{loadingState.title}</h2>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.9rem' }}>{loadingState.description}</p>
        </div>
      )}

      {/* Toolbar Top */}
      <div className="toolbar-top">
        <button className={`toolbar-btn ${activeTab === 'global' ? 'active' : ''}`} onClick={() => setActiveTab('global')} title="Ajustes Globales">
          <Settings size={22} />
          <span>General</span>
        </button>
        <button className={`toolbar-btn ${activeTab === 'lamp' ? 'active' : ''}`} onClick={() => setActiveTab('lamp')} title="Geometría Lámpara">
          <Box size={22} />
          <span>Lámpara</span>
        </button>
        <button className={`toolbar-btn ${activeTab === 'image' ? 'active' : ''}`} onClick={() => setActiveTab('image')} title="Proyección de Imagen">
          <ImageIcon size={22} />
          <span>Imagen</span>
        </button>
        <button className={`toolbar-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')} title="Herramientas y Exportación">
          <Settings2 size={22} />
          <span>Exportar</span>
        </button>
        <button className={`toolbar-btn ${activeTab === 'additional' ? 'active' : ''}`} onClick={() => setActiveTab('additional')} title="Funciones Adicionales">
          <Layers size={22} />
          <span>Adicional</span>
        </button>
      </div>

      <div className="main-content">
        {/* Main Viewport */}
        <div className="viewport">
        <Scene
          activeTab={activeTab}
          setActiveTab={setActiveTab}
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
          onCalculateComplete={() => setLoadingState({ isLoading: false })}
          onValidateComplete={() => setLoadingState({ isLoading: false })}
          onExportComplete={() => setLoadingState({ isLoading: false })}
          bgColor={bgColor}
          lightFillColor={lightFillColor}
          hideValidationMap={hideValidationMap}
          onImageTransformChange={handleImageTransformChange}
        />

        {/* Global Toolbar overlay for quick actions */}
        <div className="overlay-controls" style={{ flexDirection: 'column' }}>
           <div style={{ display: 'flex', gap: '8px' }}>
             <button className="btn btn-primary" onClick={handleCalculate} style={{ padding: '8px 16px', fontSize: '0.8rem', width: 'auto' }}>
               <Calculator size={16} /> 1. Generar Vista
             </button>
             <button className="btn btn-blue" onClick={handleValidate} style={{ padding: '8px 16px', fontSize: '0.8rem', width: 'auto' }}>
               <Lightbulb size={16} /> 2. Validar Sombra
             </button>
             <button className="btn btn-secondary" onClick={() => setHideValidationMap(!hideValidationMap)} style={{ padding: '8px 16px', fontSize: '0.8rem', width: 'auto' }} title="Apagar o Encender Sombra de Validación">
               {hideValidationMap ? <LightbulbOff size={16} /> : <Lightbulb size={16} />}
             </button>
           </div>
           <div style={{ display: 'flex', gap: '8px' }}>
             <button className="btn btn-secondary" onClick={handleReset} style={{ padding: '8px 16px', fontSize: '0.8rem', width: '100%' }}>
               <Trash2 size={16} /> Limpiar Memoria/Caché
             </button>
           </div>
        </div>
      </div>

      {/* Properties Panel Right */}
      <div className="properties-panel">
        <div className="panel-header">
          <h2>
            {activeTab === 'global' && <><Settings size={20} color="var(--accent)"/> Ajustes Globales</>}
            {activeTab === 'lamp' && <><Box size={20} color="var(--accent)"/> Geometría de Lámpara</>}
            {activeTab === 'image' && <><ImageIcon size={20} color="var(--accent)"/> Imagen y Proyección</>}
            {activeTab === 'export' && <><Settings2 size={20} color="var(--accent)"/> Exportación</>}
            {activeTab === 'additional' && <><Layers size={20} color="var(--accent)"/> Funciones Adicionales</>}
          </h2>
        </div>

        <div className="panel-content">
          
          {/* ----- GLOBAL SETTINGS ----- */}
          {activeTab === 'global' && (
            <>
              <div className="property-section">
                <div className="property-section-title">Entorno</div>
                <div className="control-group">
                  <label>Color de la Pared</label>
                  <select value={bgColor} onChange={(e) => setBgColor(e.target.value)}>
                    <option value="#1e293b">Oscuro</option>
                    <option value="#ffffff">Claro (Blanco)</option>
                  </select>
                </div>
                <div className="control-group">
                  <label>Color de la Luz (Validación)</label>
                  <select value={lightFillColor} onChange={(e) => setLightFillColor(e.target.value)}>
                    <option value="yellow">Luz Cálida</option>
                    <option value="white">Luz Intensa (Blanco)</option>
                    <option value="blue">Luz Fría (Neon)</option>
                  </select>
                </div>
              </div>

              <div className="property-section">
                <div className="property-section-title">Parámetros Ópticos</div>
                <div className="control-group">
                  <label>Radio Bombilla (Luz) <span>{bulbRadius.toFixed(2)} cm</span></label>
                  <div className="input-row">
                    <input type="range" min="0.1" max={maxBulbRadius} step="0.1" value={Math.min(bulbRadius, maxBulbRadius)} onChange={(e) => setBulbRadius(parseFloat(e.target.value))} />
                    <input type="number" min="0.1" max={maxBulbRadius} step="0.1" value={Math.min(bulbRadius, maxBulbRadius).toFixed(2)} onChange={(e) => setBulbRadius(parseFloat(e.target.value))} />
                  </div>
                </div>
                <div className="control-group">
                  <label>Distancia a la Pared <span>{distance} cm</span></label>
                  <div className="input-row">
                    <input type="range" min="2" max="30" step="1" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value))} />
                    <input type="number" min="2" max="30" step="1" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value))} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ----- LAMP SETTINGS ----- */}
          {activeTab === 'lamp' && (
            <>
              <div className="property-section">
                <div className="property-section-title">Forma Base</div>
                <div className="control-group">
                  <select value={shapeType} onChange={(e) => {
                    setShapeType(e.target.value);
                    if (e.target.value === 'box' && bulbRadius > Math.min(boxWidth / 2, boxDepth / 2) - thickness) {
                      setBulbRadius(Math.max(0.1, Math.min(boxWidth / 2, boxDepth / 2) - thickness));
                    } else if (e.target.value === 'cylinder' && bulbRadius > radius - thickness) {
                      setBulbRadius(Math.max(0.1, radius - thickness));
                    }
                  }}>
                    <option value="cylinder">Cilindro Clásico</option>
                    <option value="box">Caja (Rectángulo Redondeado)</option>
                  </select>
                </div>

                {shapeType === 'cylinder' ? (
                  <div className="control-group">
                    <label>Radio Cilindro <span>{radius} cm</span></label>
                    <div className="input-row">
                      <input type="range" min="1" max="10" step="0.1" value={radius} onChange={(e) => {
                        const v = parseFloat(e.target.value); setRadius(v);
                        if (bulbRadius > v - thickness) setBulbRadius(Math.max(0.1, v - thickness));
                      }} />
                      <input type="number" min="1" max="10" step="0.1" value={radius} onChange={(e) => setRadius(parseFloat(e.target.value))} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="control-group">
                      <label>Ancho (X) <span>{boxWidth} cm</span></label>
                      <div className="input-row">
                        <input type="range" min="2" max="30" step="0.5" value={boxWidth} onChange={(e) => setBoxWidth(parseFloat(e.target.value))} />
                        <input type="number" min="2" max="30" step="0.5" value={boxWidth} onChange={(e) => setBoxWidth(parseFloat(e.target.value))} />
                      </div>
                    </div>
                    <div className="control-group">
                      <label>Prof. (Y) <span>{boxDepth} cm</span></label>
                      <div className="input-row">
                        <input type="range" min="2" max="30" step="0.5" value={boxDepth} onChange={(e) => setBoxDepth(parseFloat(e.target.value))} />
                        <input type="number" min="2" max="30" step="0.5" value={boxDepth} onChange={(e) => setBoxDepth(parseFloat(e.target.value))} />
                      </div>
                    </div>
                    <div className="control-group">
                      <label>Radio Esquina <span>{boxCornerRadius} cm</span></label>
                      <div className="input-row">
                        <input type="range" min="0" max={Math.min(boxWidth/2, boxDepth/2)} step="0.5" value={boxCornerRadius} onChange={(e) => setBoxCornerRadius(parseFloat(e.target.value))} />
                        <input type="number" min="0" max={Math.min(boxWidth/2, boxDepth/2)} step="0.5" value={boxCornerRadius} onChange={(e) => setBoxCornerRadius(parseFloat(e.target.value))} />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="property-section">
                <div className="property-section-title">Dimensiones</div>
                <div className="control-group">
                  <label>Altura <span>{height} cm</span></label>
                  <div className="input-row">
                    <input type="range" min="5" max="30" step="0.5" value={height} onChange={(e) => setHeight(parseFloat(e.target.value))} />
                    <input type="number" min="5" max="30" step="0.5" value={height} onChange={(e) => setHeight(parseFloat(e.target.value))} />
                  </div>
                </div>
                <div className="control-group">
                  <label>Grosor Pared <span>{thickness} cm</span></label>
                  <div className="input-row">
                    <input type="range" min="0.1" max="2" step="0.05" value={thickness} onChange={(e) => {
                      const t = parseFloat(e.target.value); setThickness(t);
                      const b = shapeType === 'cylinder' ? radius : Math.min(boxWidth/2, boxDepth/2);
                      if (bulbRadius > b - t) setBulbRadius(Math.max(0.1, b - t));
                    }} />
                    <input type="number" min="0.1" max="2" step="0.05" value={thickness} onChange={(e) => setThickness(parseFloat(e.target.value))} />
                  </div>
                </div>
              </div>

              <div className="property-section">
                <div className="property-section-title">Puentes Estructurales</div>
                <div className="control-group">
                  <select value={supportType} onChange={(e) => setSupportType(e.target.value)}>
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
                  <label>Grosor Puente <span>{supportThickness} mm</span></label>
                  <input type="range" min="0.4" max="2.0" step="0.2" value={supportThickness} onChange={(e) => setSupportThickness(parseFloat(e.target.value))} />
                </div>
                <div className="control-group">
                  <label>Espaciado <span>{supportSpacing} mm</span></label>
                  <input type="range" min="2" max="50" step="1" value={supportSpacing} onChange={(e) => setSupportSpacing(parseFloat(e.target.value))} />
                </div>
              </div>
            </>
          )}

          {/* ----- IMAGE SETTINGS ----- */}
          {activeTab === 'image' && (
            <>
              <div className="property-section">
                <div className="property-section-title">Archivo de Imagen</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <label className="btn btn-primary" style={{ flex: 1, padding: '8px' }}>
                    <Upload size={16} /> Subir
                    <input type="file" accept="image/*" onChange={handleImageUpload} />
                  </label>
                  {uploadedImage && (
                    <button className="btn btn-danger" onClick={handleRemoveImage} style={{ flex: 1, padding: '8px' }} title="Eliminar">
                      <Trash2 size={16} /> Quitar
                    </button>
                  )}
                </div>
                <div className="info-box" style={{ marginTop: '8px' }}>
                   * Se recomienda formato SVG para resolución de curvas en 3D infinita. Puedes manipular la imagen libremente en el viewport central.
                </div>
              </div>

              <div className="property-section">
                <div className="property-section-title">Transformaciones</div>
                <div className="control-group">
                  <label>Posición X <span>{imgOffsetX}</span></label>
                  <div className="input-row">
                    <input type="range" min="-50" max="50" step="0.5" value={imgOffsetX} onChange={(e) => setImgOffsetX(parseFloat(e.target.value))} />
                    <input type="number" min="-50" max="50" step="0.5" value={imgOffsetX} onChange={(e) => setImgOffsetX(parseFloat(e.target.value))} />
                  </div>
                </div>
                <div className="control-group">
                  <label>Posición Y <span>{imgOffsetY}</span></label>
                  <div className="input-row">
                    <input type="range" min="-50" max="50" step="0.5" value={imgOffsetY} onChange={(e) => setImgOffsetY(parseFloat(e.target.value))} />
                    <input type="number" min="-50" max="50" step="0.5" value={imgOffsetY} onChange={(e) => setImgOffsetY(parseFloat(e.target.value))} />
                  </div>
                </div>
                <div className="control-group">
                  <label>Escala X <span>{imgScaleX}</span></label>
                  <div className="input-row">
                    <input type="range" min="1" max="150" step="1" value={imgScaleX} onChange={(e) => setImgScaleX(parseFloat(e.target.value))} />
                    <input type="number" min="1" max="150" step="1" value={imgScaleX} onChange={(e) => setImgScaleX(parseFloat(e.target.value))} />
                  </div>
                </div>
                <div className="control-group">
                  <label>Escala Y <span>{imgScaleY}</span></label>
                  <div className="input-row">
                    <input type="range" min="1" max="150" step="1" value={imgScaleY} onChange={(e) => setImgScaleY(parseFloat(e.target.value))} />
                    <input type="number" min="1" max="150" step="1" value={imgScaleY} onChange={(e) => setImgScaleY(parseFloat(e.target.value))} />
                  </div>
                </div>
                <div className="control-group">
                  <label>Rotación <span>{imgRotation}°</span></label>
                  <div className="input-row">
                    <input type="range" min="-180" max="180" step="1" value={imgRotation} onChange={(e) => setImgRotation(parseFloat(e.target.value))} />
                    <input type="number" min="-180" max="180" step="1" value={imgRotation} onChange={(e) => setImgRotation(parseFloat(e.target.value))} />
                  </div>
                </div>
              </div>

              <div className="property-section">
                <div className="property-section-title">Modos Especiales</div>
                <label className="checkbox-label">
                  <input type="checkbox" checked={imgFlipX} onChange={(e) => setImgFlipX(e.target.checked)} /> Reflejar X
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={imgFlipY} onChange={(e) => setImgFlipY(e.target.checked)} /> Reflejar Y
                </label>
                <label className="checkbox-label" style={{ marginTop: '8px', color: '#c084fc' }}>
                  <input type="checkbox" checked={invertShadow} onChange={(e) => setInvertShadow(e.target.checked)} /> Invertir Hueco/Sólido
                </label>
              </div>
            </>
          )}

          {/* ----- EXPORT SETTINGS ----- */}
          {activeTab === 'export' && (
            <>
              <div className="property-section">
                <div className="property-section-title">Opciones de Malla STL</div>
                <div className="control-group">
                  <label>Calidad Exportación (Resolución)</label>
                  <select value={exportQuality} onChange={(e) => setExportQuality(e.target.value)}>
                    <option value="low">Baja (Testeo Rápido)</option>
                    <option value="medium">Media (Balanceada)</option>
                    <option value="high">Alta (Recomendada)</option>
                    <option value="ultra">Ultra (Detalle Máximo)</option>
                  </select>
                </div>
                <div className="info-box" style={{ marginTop: '8px' }}>
                  A mayor calidad, más pesado será el archivo STL y tardará más en generarse.
                </div>
              </div>

              <div className="property-section" style={{ border: 'none', background: 'transparent', padding: '0' }}>
                <button className="btn btn-success" onClick={handleExport} style={{ padding: '14px', fontSize: '0.95rem' }}>
                  <Download size={20} />
                  Descargar Archivo STL
                </button>
              </div>
            </>
          )}

          {/* ----- ADDITIONAL SETTINGS ----- */}
          {activeTab === 'additional' && (
            <>
              <div className="property-section">
                <div className="property-section-title">En Desarrollo (Próximamente)</div>
                <div className="info-box" style={{ marginBottom: '16px' }}>
                  Estos controles son placeholders para futuras versiones. Por el momento solo ajustan su estado visual.
                </div>
                
                <label className="checkbox-label">
                  <input type="checkbox" /> Poste para sostener el bombillo
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" /> Agujero para colgar en pared
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" /> Generación de falsa tapa (Ocultar hardware)
                </label>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  </div>
  );
}

export default App;
