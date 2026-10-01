// Colores de la escena 3D (compartidos entre el visor y la barra de herramientas).

export const LIGHT_COLORS = {
  warm: { rgb: [255, 196, 92] },
  white: { rgb: [255, 250, 240] },
  cold: { rgb: [110, 200, 255] },
};

export const WALL_COLORS = { dark: '#1b1f26', light: '#e7e4de' };

// Tonos de PLA claro para que se distingan las piezas sin colores estridentes
export const PART_COLORS = { shade: '#ece6dc', cap: '#d3cbbd', base: '#b9b0a2', post: '#8b9099' };

// Litofanía: brillo relativo de cada escalón (atenuación aproximada del PLA claro, 1/mm)
const LITHO_ATTENUATION = 1.2;
export const lithoBrightness = (level, step) => Math.exp(-LITHO_ATTENUATION * level * step);
