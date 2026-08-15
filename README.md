# Dev.Text

Overlay de edición visual para sitios Next.js en desarrollo local. Corre como un servicio
único (`localhost:4477`), independiente de cualquier proyecto — un solo `<script>` lo
conecta a cada sitio que lo use.

No es un editor de "vista previa": los cambios de texto y de estilo se escriben directo en
el código fuente del proyecto (con las salvedades de seguridad que se explican abajo), no
solo se muestran en el navegador.

## Cómo se conecta a un proyecto

En el `layout.tsx` (u otro punto de entrada) del sitio, **solo en desarrollo**:

```tsx
{process.env.NODE_ENV === "development" && (
  <script src={`http://localhost:4477/devtext.js?projectPath=${encodeURIComponent(process.cwd())}`} />
)}
```

El dev server del proyecto debe correr con Turbopack (`next dev --turbopack`) — es la regla
de uso, no un requisito técnico del propio Dev.Text.

## Uso

1. Click en el botón "✎ Dev.Text" (esquina inferior derecha) para activar el modo edición.
2. Pasar el mouse resalta el texto editable; click abre el editor sobre ese elemento.
3. La barra inferior permite: fuente (buscador de Google Fonts local + instalación real de
   `@fontsource/*` + subida de archivo propio), tamaño, negrita/cursiva/subrayado/tachado,
   alineación, mayúsculas/minúsculas, sombra, espaciado de letras, interlineado, color de
   texto y de fondo.
4. Al guardar (click fuera del elemento, Escape, o "✓ Guardar y copiar"), Dev.Text intenta
   aplicar el cambio directo al código fuente del proyecto (ver siguiente sección). El toast
   confirma qué se escribió y dónde, o por qué no se pudo.

## Qué escribe al código, y qué no

**Texto:** busca el texto original en los archivos `.tsx/.ts/.jsx/.js` del proyecto
(excluye `node_modules`, `.next`, `.git`, `dev-fonts`, `_archive`). Si aparece exactamente
una vez en exactamente un archivo, lo reemplaza ahí mismo. Si el reemplazo cae dentro de un
string entre comillas, escapa comillas embebidas en el texto nuevo para no romper la
sintaxis.

**Estilo** (fuente/tamaño/color/alineación/etc.): parsea el archivo `.tsx`/`.jsx` con un AST
real (`@babel/parser` + `@babel/traverse` + `@babel/generator`) y busca la etiqueta JSX cuyo
contenido de texto coincide exactamente con el original. Si la encuentra, inyecta o mergea
un `style={{...}}` real en esa etiqueta (conserva las claves de estilo que Dev.Text no tocó).

**Regla de seguridad no negociable:** si el texto no aparece como contenido JSX literal en
el archivo — es decir, viene de un dato compartido (un array/objeto en `lib/*.ts` renderizado
por una sola etiqueta genérica, ej. `cityGuides[].tagline` usado por 15 páginas de ciudad) —
Dev.Text **se niega a escribir el estilo**. Aplicarlo ahí cambiaría la apariencia de todos
los sitios que reusan esa etiqueta, no solo el que se está editando.

**Cuándo no aplica nada:** texto ambiguo (aparece 0 veces, o más de una vez en un archivo, o
en varios archivos), o estilo sobre texto que no vive en JSX literal. En esos casos no toca
ningún archivo — copia una nota legible al portapapeles y la guarda en
`logs/<project-slug>.jsonl` como respaldo, para aplicar el cambio a mano.

## Endpoints

| Ruta | Método | Qué hace |
|---|---|---|
| `/devtext.js?projectPath=...` | GET | Sirve el script del overlay |
| `/api/fonts?q=...` | GET | Busca en el mirror local de Google Fonts (1500+ familias) |
| `/api/fonts?family=slug` | GET | Descarga el archivo de una familia específica |
| `/api/fontsource` | GET/POST | Consulta/instala `@fontsource/<slug>` en el proyecto vía `npm install` |
| `/api/apply-text` | POST | `{projectPath, originalText, newText}` — reemplazo de texto en el código |
| `/api/apply-style` | POST | `{projectPath, originalText, cssStyle}` — inyecta/mergea `style={{...}}` en el JSX |
| `/api/edit-log` | GET/POST | Historial de cambios por proyecto (`logs/<slug>.jsonl`) |

## Servicio

Corre como `systemd --user` service (`devtext.service`), siempre activo:

```
systemctl --user status devtext.service
systemctl --user restart devtext.service   # necesario después de tocar server.mjs (sin hot-reload)
```

`ExecStart` apunta a `/mnt/sdc1/EdgeMarketing/tools/devtext/server.mjs`.

## Instalación

```
npm install
```

Instala `@babel/parser`, `@babel/traverse`, `@babel/generator` y `@babel/types` — usados
solo por `/api/apply-style` para parsear y parchear JSX de forma segura.
