import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Image as ImageIcon, Lamp, Grid3x3, Puzzle, Download, Eye, EyeOff, LoaderCircle, Cylinder, Box,
  FlipHorizontal2, FlipVertical2, Lock, Unlock, Sun, Moon, Focus, Expand, Shrink, Lightbulb, Check,
  TriangleAlert, Info, X, Move, Languages, Contrast, Layers, FilePlus, FolderOpen, Save, FileText,
  Heart, CircleHelp, MemoryStick,
} from 'lucide-react';
import Scene from './Scene';
import { LIGHT_COLORS, WALL_COLORS } from './theme';
import { Field, Segmented, Switch, SelectField, Card, IconToggle } from './components/ui';
import ImageDrop from './components/ImageDrop';
import CapGlow from './components/CapGlow';
import Tour from './components/Tour';
import { createPreviewEngine, exportStl, exportPartStl } from './engine/client';
import { loadImageLuminance, defaultImage, defaultCapImage } from './engine/image';
import {
  PROJECT_EXT, canPickFiles, sanitizeSettings, serializeProject, parseProject, pickSaveTarget, writeToHandle,
  pickProjectFile, projectBaseName, isAbort, autosavePut, autosaveLoad,
} from './engine/project';
import { QUALITY } from './core/engine';
import { DEFAULT_PARTS, DEFAULT_CAP, capThickness as capTotalThickness } from './core/parts';
import { zipFiles } from './engine/zip';
import { useI18n, setLanguage, LANGUAGES } from './i18n';
import { DONATE_URL } from './config';
import './index.css';

// Holgura del encastre según el tipo de impresión (mm)
// Los textos de la interfaz están en src/i18n/locales (labelKey = clave de traducción)
const NOZZLES = {
  '0.4': { label: 'FDM 0.4', clearance: 0.2 },
  '0.2': { label: 'FDM 0.2', clearance: 0.15 },
  resin: { labelKey: 'partsTab.resin', clearance: 0.1 },
};

const BRIDGES = ['none', 'vertical', 'horizontal', 'diagonal_45', 'diagonal_neg45', 'grid', 'diagonal_cross'];

const TABS = [
  { id: 'image', icon: <ImageIcon size={16} /> },
  { id: 'lamp', icon: <Lamp size={16} /> },
  { id: 'bridges', icon: <Grid3x3 size={16} /> },
  { id: 'parts', icon: <Puzzle size={16} /> },
];

const PIECES = ['shade', 'base', 'cap', 'post'];

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const round1 = (v) => Math.round(v * 10) / 10;

// Por debajo de esta distancia (mm) el bombillo marca un punto brillante en la litofanía
const LITHO_MIN_GAP = 15;

const stlBlob = (buffer) => new Blob([buffer], { type: 'model/stl' });

// Valores permitidos de los ajustes de texto al abrir un proyecto
const SETTING_CHOICES = {
  shapeType: ['cylinder', 'box'],
  supportType: BRIDGES,
  nozzle: Object.keys(NOZZLES),
  cap: { mode: ['plain', 'litho'] },
  wallTone: Object.keys(WALL_COLORS),
  lightColor: Object.keys(LIGHT_COLORS),
  exportQuality: Object.keys(QUALITY),
  exportTarget: ['all', ...PIECES],
};

// Marcas en localStorage (tutorial visto, aviso de memoria leído)
const FLAGS = { tour: 'shade_lamp.tourDone', memory: 'shade_lamp.memoryNoticeSeen' };
const readFlag = (key) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (key) => {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Sin almacenamiento: se volverá a mostrar la próxima vez
  }
};

// Chrome marca así la página cuando descartó la pestaña para liberar memoria y la recargó
const wasDiscarded = typeof document !== 'undefined' && document.wasDiscarded === true;

function App() {
  const { t, lang, locale } = useI18n();
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

  // Tapa (mm): lisa o litofanía por capas con su propia imagen
  const [cap, setCap] = useState(() => ({ ...DEFAULT_CAP }));
  const setCapValue = (key) => (value) => setCap((c) => ({ ...c, [key]: value }));
  const [capImageName, setCapImageName] = useState(null);
  const [capImageData, setCapImageData] = useState(() => defaultCapImage());

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
  const [exportTarget, setExportTarget] = useState('all'); // 'all' o una pieza
  const [exporting, setExporting] = useState(null); // { progress }
  const [toast, setToast] = useState(null);
  const [supportPrompt, setSupportPrompt] = useState(false); // letrero de apoyo tras exportar

  // ───────────── Proyecto ─────────────
  // Todo lo que se guarda en el archivo y en el autoguardado (las imágenes van aparte)
  const settings = {
    bulbRadius, distance, shapeType, radius, boxWidth, boxDepth, boxCornerRadius, height, thickness, rim,
    imgOffsetX, imgOffsetY, imgScaleX, imgScaleY, lockAspect, imgRotation, imgFlipX, imgFlipY, invertShadow,
    supportType, supportThickness, supportSpacing,
    nozzle, partsEnabled, baseThickness, capThickness, lipLength, clearance, postDiameter, cableDiameter, cap,
    wallTone, lightColor, exportQuality, exportTarget,
  };
  const setters = {
    bulbRadius: setBulbRadius, distance: setDistance, shapeType: setShapeType, radius: setRadius,
    boxWidth: setBoxWidth, boxDepth: setBoxDepth, boxCornerRadius: setBoxCornerRadius, height: setHeight,
    thickness: setThickness, rim: setRim,
    imgOffsetX: setImgOffsetX, imgOffsetY: setImgOffsetY, imgScaleX: setImgScaleX, imgScaleY: setImgScaleY,
    lockAspect: setLockAspect, imgRotation: setImgRotation, imgFlipX: setImgFlipX, imgFlipY: setImgFlipY,
    invertShadow: setInvertShadow,
    supportType: setSupportType, supportThickness: setSupportThickness, supportSpacing: setSupportSpacing,
    nozzle: setNozzle, partsEnabled: setPartsEnabled, baseThickness: setBaseThickness, capThickness: setCapThickness,
    lipLength: setLipLength, clearance: setClearance, postDiameter: setPostDiameter, cableDiameter: setCableDiameter,
    cap: setCap,
    wallTone: setWallTone, lightColor: setLightColor, exportQuality: setExportQuality, exportTarget: setExportTarget,
  };
  const settingsJson = JSON.stringify(settings);
  const [defaults] = useState(settings); // valores iniciales, para «Nuevo proyecto»

  const [projectName, setProjectName] = useState(null);
  const fileHandleRef = useRef(null); // archivo abierto o guardado (selector nativo)
  const openInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  // Último estado guardado en archivo; si el actual difiere, hay cambios sin guardar
  const [savedState, setSavedState] = useState(() => ({ json: settingsJson, wall: imageData, cap: capImageData }));
  const dirty = savedState.json !== settingsJson || savedState.wall !== imageData || savedState.cap !== capImageData;
  const [restored, setRestored] = useState(false); // el autoguardado ya se leyó
  const storedImagesRef = useRef({}); // imágenes ya escritas en el autoguardado

  const [tourOpen, setTourOpen] = useState(() => !readFlag(FLAGS.tour));
  const [notice, setNotice] = useState(() => (wasDiscarded ? 'discarded' : readFlag(FLAGS.memory) ? null : 'memory'));

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
      cap,
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
    partsEnabled, baseThickness, capThickness, lipLength, clearance, effPostDiameter, effCableDiameter, cap]);
  const isLitho = partsEnabled && cap.mode === 'litho';
  // Espacio entre la superficie del bombillo y la tapa
  const lithoGap = (bulbDepth - effBulbRadius) * 10;

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
    engineRef.current?.setCapImage(capImageData);
  }, [capImageData]);

  useEffect(() => {
    setComputing(true);
    // A partir de esta petición, la vista previa ya usa las imágenes nuevas
    const sent = sentImageRef.current;
    if (!sent || sent.wall !== imageData || sent.cap !== capImageData) {
      sentImageRef.current = { wall: imageData, cap: capImageData };
      awaitingImageRef.current = true;
    }
    engineRef.current?.request(engineParams, showWall);
  }, [engineParams, imageData, capImageData, showWall]);

  useEffect(() => {
    if (!supportPrompt) return undefined;
    const timer = setTimeout(() => setSupportPrompt(false), 15000);
    return () => clearTimeout(timer);
  }, [supportPrompt]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
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

  const handleImageFile = async (file, target = 'wall') => {
    if (imageLoading) return;
    setImageLoading({ progress: 0, stage: 'read' });
    try {
      const data = await loadImageLuminance(file, (progress, stage) => setImageLoading({ progress, stage }));
      setImageLoading({ progress: 0.85, stage: 'lamp' });
      const name = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      if (target === 'cap') {
        setCapImageName(name);
        setCapImageData(data);
        return;
      }
      setImageName(name);
      setImageData(data);
      if (lockAspect) setImgScaleY(round1(imgScaleX * (data.height / data.width)));
    } catch (err) {
      console.error('Error leyendo la imagen:', err);
      setImageLoading(null);
      setToast({ kind: 'error', text: t('image.readError') });
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
  const baseName = `${t('files.lamp')}_${imageName || t('files.sample')}`;
  const exportOptions = partsEnabled ? ['all', ...PIECES] : ['shade'];
  const target = exportOptions.includes(exportTarget) ? exportTarget : 'shade';
  const needsShade = target === 'all' || target === 'shade';

  const partFile = (kind) => `${baseName}_${t(`files.${kind}`)}.stl`;
  const shadeFile = () => `${baseName}_${t('files.shade')}_${exportQuality}.stl`;
  const mb = (bytes) => (bytes / 1e6).toFixed(1);

  const partStl = (kind) => exportPartStl(engineParams, kind, capImageData);
  // Tras una descarga es buen momento para invitar a apoyar el proyecto
  const askSupport = () => {
    if (DONATE_URL) setSupportPrompt(true);
  };

  const handleExport = async () => {
    setExporting({ progress: 0 });
    const t0 = performance.now();
    try {
      if (!needsShade) {
        const name = partFile(target);
        downloadBlob(stlBlob(await partStl(target)), name);
        setToast({ kind: 'ok', text: t('export.donePart', { name }) });
        askSupport();
        return;
      }
      // La pantalla ocupa casi todo el tiempo; las piezas, el resto de la barra
      const shareOfShade = target === 'all' ? 0.85 : 1;
      const shade = await exportStl(engineParams, imageData, exportQuality, (p) => setExporting({ progress: p * shareOfShade }));
      const coarsened = shade.coarsened ? t('export.coarsened', { cell: shade.cell.toFixed(3) }) : '';
      if (target === 'shade') {
        const name = shadeFile();
        downloadBlob(stlBlob(shade.buffer), name);
        setToast({
          kind: 'ok',
          text: t('export.doneShade', {
            name,
            triangles: shade.triangles.toLocaleString(locale),
            mb: mb(shade.buffer.byteLength),
            seconds: (shade.ms / 1000).toFixed(1),
          }) + coarsened,
        });
        askSupport();
        return;
      }
      const files = [{ name: shadeFile(), data: shade.buffer }];
      const others = PIECES.filter((k) => k !== 'shade');
      for (const [i, k] of others.entries()) {
        files.push({ name: partFile(k), data: await partStl(k) });
        setExporting({ progress: shareOfShade + ((1 - shareOfShade) * (i + 1)) / others.length });
      }
      const zip = zipFiles(files);
      const name = `${baseName}_${exportQuality}.zip`;
      downloadBlob(zip, name);
      setToast({
        kind: 'ok',
        text: t('export.doneAll', {
          name,
          count: files.length,
          mb: mb(zip.size),
          seconds: ((performance.now() - t0) / 1000).toFixed(1),
        }) + coarsened,
      });
      askSupport();
    } catch (err) {
      console.error('Error generando STL:', err);
      setToast({ kind: 'error', text: t('export.error', { message: err.message }) });
    } finally {
      setExporting(null);
    }
  };

  // ───────────── Guardar y abrir proyectos ─────────────
  /** Aplica ajustes e imágenes; devuelve el estado para marcarlo como guardado. */
  const applyProject = ({ settings: saved, wall, cap: capEntry }) => {
    const clean = sanitizeSettings(saved, defaults, SETTING_CHOICES);
    for (const [key, set] of Object.entries(setters)) set(clean[key]);
    const wallImage = wall?.image ?? defaultImage();
    const capImage = capEntry?.image ?? defaultCapImage();
    setImageName(wall ? wall.name || t('files.image') : null);
    setImageData(wallImage);
    setCapImageName(capEntry ? capEntry.name || t('files.image') : null);
    setCapImageData(capImage);
    return { json: JSON.stringify(clean), wall: wallImage, cap: capImage };
  };

  const busy = !!(imageLoading || exporting || saving);
  const confirmDiscard = () => !dirty || window.confirm(t('project.confirmDiscard'));

  const handleSave = async (saveAs = false) => {
    if (busy) return;
    const fileName = `${projectName || baseName}${PROJECT_EXT}`;
    const snapshot = { json: settingsJson, wall: imageData, cap: capImageData };
    try {
      // Primero el selector: el navegador lo exige justo después del clic
      const handle = await pickSaveTarget(saveAs ? null : fileHandleRef.current, fileName);
      setSaving(true);
      const blob = await serializeProject({
        settings,
        wall: imageName ? { name: imageName, image: imageData } : null,
        cap: capImageName ? { name: capImageName, image: capImageData } : null,
      });
      if (handle) await writeToHandle(handle, blob);
      else downloadBlob(blob, fileName);
      const savedName = handle ? handle.name : fileName;
      fileHandleRef.current = handle;
      setProjectName(projectBaseName(savedName));
      setSavedState(snapshot);
      setToast({ kind: 'ok', text: t('project.saved', { name: savedName }) });
    } catch (err) {
      if (!isAbort(err)) {
        console.error('Error guardando el proyecto:', err);
        setToast({ kind: 'error', text: t('project.saveError') });
      }
    } finally {
      setSaving(false);
    }
  };

  const openProjectFile = async (file, handle = null) => {
    const progress = (p, stage = 'project') => setImageLoading({ progress: p, stage, titleKey: 'project.opening' });
    progress(0);
    try {
      const project = await parseProject(file, (p) => progress(p));
      progress(0.85, 'lamp');
      const state = applyProject(project);
      fileHandleRef.current = handle;
      setProjectName(projectBaseName(file.name));
      setSavedState(state);
      setTab('image');
      setToast({ kind: 'ok', text: t('project.opened', { name: file.name }) });
    } catch (err) {
      console.error('Error abriendo el proyecto:', err);
      setImageLoading(null);
      setToast({ kind: 'error', text: t('project.openError') });
    }
  };

  const handleOpen = async () => {
    if (busy || !confirmDiscard()) return;
    if (!canPickFiles) {
      openInputRef.current?.click();
      return;
    }
    try {
      const { file, handle } = await pickProjectFile();
      await openProjectFile(file, handle);
    } catch (err) {
      if (!isAbort(err)) {
        console.error('Error abriendo el proyecto:', err);
        setToast({ kind: 'error', text: t('project.openError') });
      }
    }
  };

  const handleNew = () => {
    if (busy || !confirmDiscard()) return;
    const state = applyProject({ settings: {}, wall: null, cap: null });
    fileHandleRef.current = null;
    setProjectName(null);
    setSavedState(state);
    setTab('image');
  };

  // Al abrir la app se recupera el autoguardado (p. ej. si el navegador recargó la pestaña)
  useEffect(() => {
    let cancelled = false;
    autosaveLoad().then((saved) => {
      if (cancelled) return;
      if (saved) {
        const state = applyProject({ settings: saved.state.settings, wall: saved.wall, cap: saved.cap });
        storedImagesRef.current = { wall: state.wall, cap: state.cap };
        setProjectName(saved.state.name ?? null);
        setSavedState(saved.state.dirty ? { json: null, wall: null, cap: null } : state);
        if (!wasDiscarded) setToast({ kind: 'ok', text: t('project.restored') });
      }
      setRestored(true);
    });
    return () => { cancelled = true; };
    // Solo al iniciar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return undefined;
    const timer = setTimeout(() => autosavePut('state', { settings: JSON.parse(settingsJson), name: projectName, dirty }), 400);
    return () => clearTimeout(timer);
  }, [restored, settingsJson, projectName, dirty]);

  // Las imágenes se escriben solo cuando cambian (pueden pesar varios MB)
  useEffect(() => {
    if (!restored) return;
    const stored = storedImagesRef.current;
    if (stored.wall !== imageData) {
      stored.wall = imageData;
      autosavePut('wall', imageName ? { name: imageName, image: imageData } : null);
    }
    if (stored.cap !== capImageData) {
      stored.cap = capImageData;
      autosavePut('cap', capImageName ? { name: capImageName, image: capImageData } : null);
    }
  }, [restored, imageData, imageName, capImageData, capImageName]);

  // Ctrl+S guarda (Ctrl+Mayús+S: guardar como) y Ctrl+O abre
  const shortcutsRef = useRef(null);
  useEffect(() => {
    shortcutsRef.current = { save: handleSave, open: handleOpen };
  });
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        shortcutsRef.current?.save(e.shiftKey);
      } else if (key === 'o') {
        e.preventDefault();
        shortcutsRef.current?.open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeTour = useCallback(() => {
    setTourOpen(false);
    writeFlag(FLAGS.tour);
  }, []);

  const dismissNotice = () => {
    setNotice(null);
    writeFlag(FLAGS.memory);
  };

  const sceneSize = Math.max(height, shapeType === 'cylinder' ? radius : Math.max(boxWidth, boxDepth) / 2);
  const partKinds = partsEnabled ? ['shade', 'cap', 'base', 'post'] : ['shade'];

  return (
    <div className="app">
      {/* ───────────── Panel lateral ───────────── */}
      <aside className="panel">
        <header className="brand">
          <div className="brand-mark"><Lightbulb size={18} /></div>
          <div className="brand-text">
            <h1>{t('app.title')}</h1>
            <p>{t('app.subtitle')}</p>
          </div>
          {LANGUAGES.length > 1 && (
            <label className="lang" title={t('app.language')}>
              <Languages size={14} />
              <select value={lang} onChange={(e) => setLanguage(e.target.value)} aria-label={t('app.language')}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
          )}
        </header>

        <div className="project" data-tour="project">
          <div className="project-name" title={dirty ? t('project.unsaved') : t('project.upToDate')}>
            <FileText size={14} />
            <span>{projectName || t('project.untitled')}</span>
            {dirty && <i className="dirty-dot" aria-label={t('project.unsaved')} />}
          </div>
          <button type="button" className="icon-btn" onClick={handleNew} disabled={busy} title={t('project.new')} aria-label={t('project.new')}>
            <FilePlus size={15} />
          </button>
          <button type="button" className="icon-btn" onClick={handleOpen} disabled={busy} title={t('project.openTitle')} aria-label={t('project.open')}>
            <FolderOpen size={15} />
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => handleSave()} disabled={busy} title={t('project.saveTitle')}>
            {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
            {t('project.save')}
          </button>
          <input
            ref={openInputRef}
            type="file"
            accept={`${PROJECT_EXT},.json,application/json`}
            hidden
            onChange={(e) => {
              const file = e.target.files[0];
              e.target.value = '';
              if (file) openProjectFile(file);
            }}
          />
        </div>

        {notice && (
          <div className="notice" role="status">
            <MemoryStick size={16} />
            <div>
              <strong>{t(`notice.${notice}.title`)}</strong>
              <p>{t(`notice.${notice}.text`)}</p>
            </div>
            <button type="button" onClick={dismissNotice} aria-label={t('notice.ok')} title={t('notice.ok')}><X size={14} /></button>
          </div>
        )}

        <nav className="tabs" role="tablist" data-tour="tabs">
          {TABS.map((item) => (
            <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
              {item.icon}
              <span>{t(`tabs.${item.id}`)}</span>
            </button>
          ))}
        </nav>

        <div className="panel-scroll">
          {tab === 'image' && (
            <>
              <Card title={t('image.title')} tour="image">
                <ImageDrop
                  image={imageData}
                  name={imageName}
                  isCustom={!!imageName}
                  onFile={handleImageFile}
                  onRemove={handleRemoveImage}
                />
                <p className="hint">{t('image.hint')}</p>
              </Card>

              <Card title={t('interpretation.title')} tour="interpretation">
                <Segmented
                  label={t('interpretation.label')}
                  value={invertShadow ? 'shadow' : 'light'}
                  onChange={(v) => setInvertShadow(v === 'shadow')}
                  options={[
                    { value: 'light', label: t('interpretation.light'), icon: <Sun size={14} /> },
                    { value: 'shadow', label: t('interpretation.shadow'), icon: <Moon size={14} /> },
                  ]}
                />
                <p className="hint">
                  {invertShadow ? t('interpretation.hintShadow') : t('interpretation.hintLight')}
                </p>
              </Card>

              <Card
                title={t('position.title')}
                action={(
                  <IconToggle
                    active={lockAspect}
                    onClick={() => setLockAspect((v) => !v)}
                    icon={lockAspect ? <Lock size={14} /> : <Unlock size={14} />}
                    title={lockAspect ? t('position.aspectLocked') : t('position.aspectFree')}
                  />
                )}
              >
                <Field label={t('position.width')} unit="cm" value={imgScaleX} min={1} max={150} step={0.5} onChange={setWidthKeepingAspect} />
                <Field label={t('position.height')} unit="cm" value={imgScaleY} min={1} max={150} step={0.5} onChange={setHeightKeepingAspect} />
                <Field label={t('position.x')} unit="cm" value={imgOffsetX} min={-70} max={70} step={0.1} onChange={setImgOffsetX} />
                <Field label={t('position.y')} unit="cm" value={imgOffsetY} min={-70} max={70} step={0.1} onChange={setImgOffsetY} />
                <Field label={t('position.rotation')} unit="°" value={imgRotation} min={-180} max={180} step={1} onChange={setImgRotation} />
                <Switch
                  checked={dragImage}
                  onChange={setDragImage}
                  label={t('position.drag')}
                  description={t('position.dragHint')}
                />
                <div className="toggle-row">
                  <IconToggle active={imgFlipX} onClick={() => setImgFlipX((v) => !v)} icon={<FlipHorizontal2 size={14} />} label={t('position.flipX')} />
                  <IconToggle active={imgFlipY} onClick={() => setImgFlipY((v) => !v)} icon={<FlipVertical2 size={14} />} label={t('position.flipY')} />
                </div>
              </Card>
            </>
          )}

          {tab === 'lamp' && (
            <>
              <Card title={t('lamp.shape')}>
                <Segmented
                  value={shapeType}
                  onChange={setShapeType}
                  options={[
                    { value: 'cylinder', label: t('lamp.cylinder'), icon: <Cylinder size={14} /> },
                    { value: 'box', label: t('lamp.box'), icon: <Box size={14} /> },
                  ]}
                />
                {shapeType === 'cylinder' ? (
                  <Field label={t('lamp.radius')} unit="cm" value={radius} min={1} max={10} step={0.1} onChange={setRadius} />
                ) : (
                  <>
                    <div className="grid-2">
                      <Field label={t('lamp.width')} unit="cm" value={boxWidth} min={2} max={30} step={0.5} onChange={setBoxWidth} />
                      <Field label={t('lamp.depth')} unit="cm" value={boxDepth} min={2} max={30} step={0.5} onChange={setBoxDepth} />
                    </div>
                    <Field label={t('lamp.cornerRadius')} unit="cm" value={effCorner} min={0} max={maxCorner} step={0.25} onChange={setBoxCornerRadius} />
                  </>
                )}
                <Field label={t('lamp.height')} unit="cm" value={height} min={2} max={30} step={0.5} onChange={setHeight} />
                <div className="grid-2">
                  <Field label={t('lamp.thickness')} unit="mm" value={effThickness} min={0.8} max={maxThickness} step={0.1} onChange={setThickness} />
                  <Field label={t('lamp.rim')} unit="mm" value={effRim} min={0.5} max={20} step={0.5} onChange={setRim} />
                </div>
                {partsEnabled && rim < effRim && (
                  <p className="hint">{t('lamp.rimHint', { lip: lipLength })}</p>
                )}
              </Card>

              <Card title={t('bulb.title')}>
                <Field label={t('bulb.distance')} unit="cm" value={effDistance} min={1} max={maxDistance} step={0.1} onChange={setDistance} />
                <Field label={t('bulb.radius')} unit="cm" value={effBulbRadius} min={0.1} max={maxBulbRadius} step={0.1} onChange={setBulbRadius} />
                <div className="note">
                  <Info size={14} />
                  <span>{t('bulb.note', { depth: bulbDepth.toFixed(1) })}</span>
                </div>
              </Card>
            </>
          )}

          {tab === 'bridges' && (
            <Card title={t('bridges.title')}>
              <p className="hint">{t('bridges.hint')}</p>
              <div className="chip-grid">
                {BRIDGES.map((b) => (
                  <button key={b} type="button" className={`chip${supportType === b ? ' on' : ''}`} onClick={() => setSupportType(b)}>
                    {supportType === b && <Check size={13} />}
                    {t(`bridges.types.${b}`)}
                  </button>
                ))}
              </div>
              {supportType !== 'none' && (
                <div className="grid-2">
                  <Field label={t('bridges.thickness')} unit="mm" value={supportThickness} min={0.4} max={3} step={0.1} onChange={setSupportThickness} />
                  <Field label={t('bridges.spacing')} unit="mm" value={supportSpacing} min={3} max={60} step={1} onChange={setSupportSpacing} />
                </div>
              )}
            </Card>
          )}

          {tab === 'parts' && (
            <>
              <Card title={t('partsTab.title')}>
                <Switch
                  checked={partsEnabled}
                  onChange={setPartsEnabled}
                  label={t('partsTab.toggle')}
                  description={t('partsTab.toggleHint')}
                />
              </Card>
              {partsEnabled && (
                <>
                  <Card title={t('partsTab.fitTitle')}>
                    <Segmented
                      label={t('partsTab.printType')}
                      value={nozzle}
                      onChange={(v) => { setNozzle(v); setClearance(NOZZLES[v].clearance); }}
                      options={Object.entries(NOZZLES).map(([value, n]) => ({ value, label: n.labelKey ? t(n.labelKey) : n.label }))}
                    />
                    <Field label={t('partsTab.clearance')} unit="mm" value={clearance} min={0} max={0.6} step={0.05} onChange={setClearance}
                      hint={t('partsTab.clearanceHint')} />
                  </Card>
                  <Card title={t('partsTab.sizes')}>
                    <Field label={t('partsTab.baseThickness')} unit="mm" value={baseThickness} min={1.5} max={10} step={0.5} onChange={setBaseThickness} />
                    <Field label={t('partsTab.lipLength')} unit="mm" value={lipLength} min={2} max={15} step={0.5} onChange={setLipLength} />
                    <Field label={t('partsTab.postDiameter')} unit="mm" value={effPostDiameter} min={4} max={maxPostDiameter} step={0.5} onChange={setPostDiameter} />
                    <Field label={t('partsTab.cable')} unit="mm" value={effCableDiameter} min={1} max={Math.max(1, effPostDiameter - 1.6)} step={0.5} onChange={setCableDiameter} />
                  </Card>

                  <Card title={t('cap.title')}>
                    <Segmented
                      value={cap.mode}
                      onChange={setCapValue('mode')}
                      options={[
                        { value: 'plain', label: t('cap.plain') },
                        { value: 'litho', label: t('cap.litho'), icon: <Layers size={14} /> },
                      ]}
                    />
                    {cap.mode === 'plain' ? (
                      <Field label={t('partsTab.capThickness')} unit="mm" value={capThickness} min={1} max={10} step={0.5} onChange={setCapThickness} />
                    ) : (
                      <>
                        <p className="hint">{t('cap.lithoHint')}</p>
                        <ImageDrop
                          image={capImageData}
                          name={capImageName}
                          isCustom={!!capImageName}
                          sampleLabel={t('cap.sample')}
                          onFile={(file) => handleImageFile(file, 'cap')}
                          onRemove={() => { setCapImageName(null); setCapImageData(defaultCapImage()); }}
                        />
                        {preview?.capRaster && (
                          <div className="cap-glow-wrap">
                            <CapGlow raster={preview.capRaster} step={cap.step} rgb={LIGHT_COLORS[lightColor].rgb} />
                            <span className="hint">{t('cap.glow')}</span>
                          </div>
                        )}
                        <Field label={t('cap.size')} unit="mm" value={cap.size} min={5} max={300} step={1} onChange={setCapValue('size')} />
                        <Field label={t('position.x')} unit="mm" value={cap.offsetX} min={-100} max={100} step={0.5} onChange={setCapValue('offsetX')} />
                        <Field label={t('position.y')} unit="mm" value={cap.offsetY} min={-100} max={100} step={0.5} onChange={setCapValue('offsetY')} />
                        <Field label={t('position.rotation')} unit="°" value={cap.rotation} min={-180} max={180} step={1} onChange={setCapValue('rotation')} />
                        <div className="toggle-row">
                          <IconToggle active={cap.invert} onClick={() => setCapValue('invert')(!cap.invert)} icon={<Contrast size={14} />} label={t('cap.invert')} />
                        </div>
                      </>
                    )}
                  </Card>

                  {cap.mode === 'litho' && (
                    <Card title={t('cap.layersTitle')}>
                      <Field label={t('cap.levels')} value={cap.levels} min={2} max={6} step={1} onChange={(v) => setCapValue('levels')(Math.round(v))} />
                      <Field label={t('cap.base')} unit="mm" value={cap.base} min={0.2} max={2} step={0.1} onChange={setCapValue('base')} />
                      <Field label={t('cap.step')} unit="mm" value={cap.step} min={0.1} max={1} step={0.05} onChange={setCapValue('step')} />
                      <Field label={t('cap.margin')} unit="mm" value={cap.margin} min={0.5} max={10} step={0.5} onChange={setCapValue('margin')} />
                      <Field label={t('cap.minFeature')} unit="mm" value={cap.minFeature} min={0.2} max={3} step={0.1} onChange={setCapValue('minFeature')}
                        hint={t('cap.minFeatureHint')} />
                      <div className="note">
                        <Info size={14} />
                        <span>{t('cap.printNote', { total: capTotalThickness(engineParams).toFixed(1), step: cap.step })}</span>
                      </div>
                      {lithoGap < LITHO_MIN_GAP && (
                        <div className="note warn">
                          <TriangleAlert size={14} />
                          <span>{t('cap.hotspot', { gap: Math.max(0, lithoGap).toFixed(0), min: LITHO_MIN_GAP })}</span>
                        </div>
                      )}
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Exportación siempre visible */}
        <footer className="export" data-tour="export">
          <div className="export-row">
            <select
              className="select export-target"
              value={target}
              onChange={(e) => setExportTarget(e.target.value)}
              title={t('export.target')}
              aria-label={t('export.target')}
              disabled={exportOptions.length < 2}
            >
              {exportOptions.map((k) => (
                <option key={k} value={k}>{k === 'all' ? t('export.all') : t(`parts.${k}`)}</option>
              ))}
            </select>
            <select
              className="select select-compact"
              value={exportQuality}
              onChange={(e) => setExportQuality(e.target.value)}
              title={needsShade ? t('export.quality') : t('export.qualityParts')}
              aria-label={t('export.quality')}
              disabled={!needsShade}
            >
              {['low', 'medium', 'high', 'ultra'].map((k) => (
                <option key={k} value={k}>{t(`quality.${k}`)} · {QUALITY[k].cell} mm</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleExport} disabled={!!exporting}>
            <Download size={16} />
            {target === 'all' ? t('export.buttonAll') : t('export.buttonOne', { part: t(`parts.${target}`).toLowerCase() })}
          </button>
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
                label={t(`parts.${k}`)}
                title={t(visibleParts[k] ? 'viewer.hide' : 'viewer.show', { part: t(`parts.${k}`).toLowerCase() })}
              />
            ))}
          </div>
          <div className="tool-group" data-tour="viewer-light">
            <IconToggle active={showWall} onClick={() => setShowWall((v) => !v)} icon={<Sun size={14} />} label={t('viewer.wallLight')} />
            <IconToggle
              active={dragImage}
              onClick={() => setDragImage((v) => !v)}
              icon={<Move size={14} />}
              label={t('viewer.moveImage')}
              title={t('viewer.moveImageTitle')}
            />
            {partsEnabled && (
              <IconToggle
                active={exploded}
                onClick={() => setExploded((v) => !v)}
                icon={exploded ? <Shrink size={14} /> : <Expand size={14} />}
                label={exploded ? t('viewer.assemble') : t('viewer.explode')}
              />
            )}
          </div>
          <div className="tool-spacer" />
          <div className="tool-group">
            <span className="tool-label">{t('viewer.wall')}</span>
            <IconToggle active={wallTone === 'dark'} onClick={() => setWallTone('dark')} icon={<Moon size={14} />} title={t('viewer.wallDark')} />
            <IconToggle active={wallTone === 'light'} onClick={() => setWallTone('light')} icon={<Sun size={14} />} title={t('viewer.wallBright')} />
            <span className="tool-divider" />
            <span className="tool-label">{t('viewer.light')}</span>
            {Object.entries(LIGHT_COLORS).map(([k, c]) => (
              <button
                key={k}
                type="button"
                className={`swatch${lightColor === k ? ' on' : ''}`}
                style={{ '--swatch': `rgb(${c.rgb.join(',')})` }}
                onClick={() => setLightColor(k)}
                title={t('viewer.lightColor', { color: t(`lights.${k}`).toLowerCase() })}
                aria-label={t('viewer.lightColor', { color: t(`lights.${k}`).toLowerCase() })}
              />
            ))}
          </div>
          <div className="tool-group">
            <IconToggle onClick={() => setCameraKey((k) => k + 1)} icon={<Focus size={14} />} title={t('viewer.center')} />
          </div>
        </div>

        <div className="status">
          {computing ? <LoaderCircle size={13} className="spin" /> : <span className="status-dot" />}
          {previewError ? (
            <span className="status-error">{t('viewer.error', { message: previewError })}</span>
          ) : preview ? (
            <span>
              {t('viewer.preview', {
                triangles: preview.stats.triangles.toLocaleString(locale),
                cell: preview.stats.cell.toFixed(2),
                ms: preview.stats.ms.toFixed(0),
              })}
            </span>
          ) : (
            <span>{t('viewer.computing')}</span>
          )}
        </div>

        <div className="corner-links">
          <button type="button" className="corner-link" onClick={() => setTourOpen(true)} title={t('tour.open')}>
            <CircleHelp size={14} />{t('tour.short')}
          </button>
          {DONATE_URL && (
            <a className="corner-link donate" href={DONATE_URL} target="_blank" rel="noopener noreferrer" title={t('donate.title')}>
              <Heart size={14} />{t('donate.short')}
            </a>
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
          capGlow={isLitho && preview?.capRaster ? {
            raster: preview.capRaster,
            step: cap.step,
            z: effDistance - gapCm - height - capTotalThickness(engineParams) / 10,
          } : null}
        />

        {supportPrompt && (
          <div className="support" role="status">
            <Heart size={18} className="support-heart" />
            <span>{t('donate.prompt')}</span>
            <a className="btn btn-primary" href={DONATE_URL} target="_blank" rel="noopener noreferrer" onClick={() => setSupportPrompt(false)}>
              {t('donate.short')}
            </a>
            <button type="button" onClick={() => setSupportPrompt(false)} aria-label={t('viewer.close')}><X size={14} /></button>
          </div>
        )}

        {toast && (
          <div className={`toast ${toast.kind}`} role="status">
            {toast.kind === 'ok' ? <Check size={16} /> : <TriangleAlert size={16} />}
            <span>{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} aria-label={t('viewer.close')}><X size={14} /></button>
          </div>
        )}
      </main>

      {imageLoading && (
        <div className="modal-backdrop">
          <div className="modal" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(imageLoading.progress * 100)}>
            <LoaderCircle size={28} className="spin accent" />
            <h2>{t(imageLoading.titleKey || 'loading.title')}</h2>
            <p>{t(`loading.${imageLoading.stage}`)}…</p>
            <div className="progress"><div style={{ width: `${Math.round(imageLoading.progress * 100)}%` }} /></div>
            <span className="progress-label">{Math.round(imageLoading.progress * 100)} %</span>
          </div>
        </div>
      )}

      {exporting && (
        <div className="modal-backdrop">
          <div className="modal">
            <LoaderCircle size={28} className="spin accent" />
            <h2>
              {target === 'all' ? t('export.generatingAll')
                : target === 'shade' ? t('export.generatingShade')
                  : t('export.generatingPart', { part: t(`parts.${target}`).toLowerCase() })}
            </h2>
            <p>{t('export.modalText', { quality: t(`quality.${exportQuality}`).toLowerCase() })}</p>
            <div className="progress"><div style={{ width: `${Math.round(exporting.progress * 100)}%` }} /></div>
            <span className="progress-label">{Math.round(exporting.progress * 100)} %</span>
          </div>
        </div>
      )}

      {tourOpen && <Tour onClose={closeTour} onTab={setTab} />}
    </div>
  );
}

export default App;
