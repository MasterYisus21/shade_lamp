# Lámpara de Sombras 3D

Aplicación web para diseñar lámparas de pared que proyectan una imagen como luz y
sombra, y exportarlas en STL para imprimir en 3D.

Subes una imagen en blanco y negro, ajustas su tamaño y posición sobre la pared, y
la app calcula qué partes de la pantalla deben ser huecos para que la luz del
bombillo dibuje esa imagen. La vista 3D muestra la pieza real y la luz que
proyecta, calculada a partir de esa misma geometría.

## Funciones

- **Formas:** cilindro y caja de esquinas redondeadas.
- **Malla cerrada y nítida:** contornos exactos con esquinas definidas y STL
  binario ligero. Las paredes de los huecos apuntan al bombillo para que el
  grosor no recorte la sombra.
- **Puentes** opcionales para sujetar las islas sueltas.
- **Piezas encastrables:** base (pared), tapa (habitación) y poste hueco para el
  cable, con holgura según el tipo de impresión (FDM 0.4, FDM 0.2 o resina).
- **Tapa litofanía por capas** (opcional): un logo propio en hasta 6 niveles de
  tono. La cara hacia la habitación es plana y los escalones miran al bombillo,
  así se imprime acostada y sin soportes; un aro con el labio le da rigidez.
- **Cálculo en paralelo:** la vista previa se calcula en un Web Worker y la
  exportación reparte el trabajo entre los núcleos del procesador.
- **Proyectos:** «Guardar» crea un archivo `.shadelamp` (JSON con los ajustes y
  las imágenes en PNG, sin pérdida) y «Abrir» lo carga. En Chrome y Edge, tras
  la primera vez, Ctrl+S guarda sobre el mismo archivo. Además el diseño se
  autoguarda en el navegador (IndexedDB) y se recupera si la pestaña se recarga.
- **Tutorial** guiado la primera vez (y con el botón «Tutorial» del visor).

## Uso

```bash
npm install
npm run dev
```

Abre la dirección que muestra Vite (normalmente http://localhost:5173).

Para verificar que el motor genera mallas cerradas, con casos fijos y 200
configuraciones aleatorias:

```bash
node scripts/check-mesh.mjs medium 200
```

## Publicar

```bash
npm run build
```

La carpeta `dist/` es un sitio estático con rutas relativas: se puede subir tal
cual a GitHub Pages, Netlify, Cloudflare Pages o cualquier hosting, también en
una subcarpeta. Todo el cálculo ocurre en el navegador; no hace falta servidor.

**Seguridad.** El build añade una política de seguridad de contenido (CSP)
como `<meta>`, así la página solo carga código, estilos y fuentes de su propio
dominio y no puede enviar datos a terceros. También genera `dist/_headers`
(Netlify, Cloudflare Pages) con cabeceras que una `<meta>` no puede poner, como
la protección contra que otro sitio la incruste. La política está en
`vite.config.js`: si añades algo externo (analítica, otra fuente…), agrégalo
ahí. Los archivos que abre el usuario se validan: imágenes de hasta 50 MB y 100
megapíxeles, proyectos de hasta 100 MB, ajustes limitados a los rangos de la
interfaz y nombres sin rutas ni caracteres reservados.

Para mostrar el botón «Apoyar» (en el visor y tras cada exportación), pon tu
enlace de donaciones en `DONATE_URL` de `src/config.js`.

## Idiomas

Los textos de la interfaz están en `src/i18n/locales/`, un archivo JSON por
idioma (`es.json`, `en.json`). Para añadir otro:

1. Copia `es.json` con el código del idioma como nombre (`fr.json`, `pt-br.json`…).
2. Cambia `_meta.name` (lo que se ve en el selector) y `_meta.locale` (formato
   de números, p. ej. `fr`).
3. Traduce los textos. Las claves que falten se muestran en español; los
   `{nombres}` entre llaves son valores que pone la app y deben conservarse.

El idioma aparece en el selector sin tocar el código. La app recuerda la
elección y, la primera vez, usa el idioma del navegador si está disponible.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/core/` | Motor geométrico sin dependencias del navegador: perfil de la forma, campo sólido/hueco, mallado, piezas y STL. |
| `src/engine/` | Workers, carga de imágenes, exportación en paralelo y proyectos (archivo y autoguardado). |
| `src/components/` | Componentes de la interfaz. |
| `src/i18n/` | Traducciones (un JSON por idioma en `locales/`). |
| `src/Scene.jsx` | Visor 3D (react-three-fiber). |
| `scripts/` | Herramientas de verificación. |

## Coordenadas

El bombillo está en el origen y la pared en `Z = distancia`. La pantalla se
desenrolla en 2D como (longitud de arco, Z). Internamente todo se calcula en mm;
la interfaz usa cm para las medidas grandes y mm para grosores y holguras.
