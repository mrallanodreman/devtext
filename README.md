# SeoEditor (antes Dev.Text)

SeoEditor es una overlay de edición visual diseñada para editores de texto, redactores y equipos de contenido que trabajan sobre sitios Next.js en desarrollo local. Proporciona una interfaz WYSIWYG ligera que permite editar copy y estilos en la página y, cuando es seguro hacerlo, aplicar esos cambios directamente al código fuente del proyecto.

> Nota: SeoEditor está pensado para entornos de desarrollo local. No es una herramienta de edición en producción ni un CMS remoto: los cambios se aplican al repositorio del proyecto cuando la herramienta determina que es seguro hacerlo.

Características principales

- Edición in-context: resalta y edita texto directamente en la página. Guarda cambios en el código cuando hay una coincidencia única.
- Aplicación de estilos: inyecta o mergea `style={{...}}` en etiquetas JSX para cambios visuales (fuente, tamaño, color, alineación, espaciado, sombra, etc.).
- Gestión de fuentes: exploración de Google Fonts en un mirror local y opción para instalar familias vía `@fontsource` o subir una fuente propia.
- Historial de edición por proyecto (`logs/<slug>.jsonl`) con respaldo legible en caso de cambios que no puedan aplicarse automáticamente.
- Servicio persistente: pensado para correr como servicio de usuario (systemd --user) y servir un solo bundle (`localhost:4477`) que puede conectarse a múltiples proyectos en desarrollo.

Por qué es útil para redactores y editores

- Flujo rápido de pruebas: prueba variaciones de copy y estilo sin abrir el editor de código manualmente.
- Aplicación segura: SeoEditor intenta escribir los cambios directamente en archivos de código SÓLO cuando la sustitución es inequívoca, evitando efectos colaterales en datos compartidos.
- Iteración visual: permite combinar edición de texto con ajustes tipográficos y de espaciado en tiempo real.

Instalación (desarrollo)

1. Clona el repo y entra en la carpeta del proyecto:

```bash
git clone git@github.com:mrallanodreman/devtext.git
cd devtext
```

2. Instala dependencias:

```bash
npm install
```

3. Dependencias para parseo/patching de JSX (usadas por el endpoint de estilo):

```bash
npm i --save @babel/parser @babel/traverse @babel/generator @babel/types
```

4. Lanza el servicio (ejemplo con node):

```bash
node server.mjs
# o como servicio de usuario con systemd: systemctl --user start devtext.service
```

Conexión con un proyecto Next.js (solo en desarrollo)

Inserta el script del overlay en tu layout o punto de entrada, SOLO cuando `NODE_ENV === "development"`:

```tsx
{process.env.NODE_ENV === "development" && (
  <script src={`http://localhost:4477/devtext.js?projectPath=${encodeURIComponent(process.cwd())}`} />
)}
```

Requisitos de uso

- El servidor del proyecto debe estar en entorno de desarrollo. SeoEditor está diseñado para entornos locales.
- SeoEditor sólo aplicará cambios al código cuando sea seguro (ver sección "Seguridad").

Cómo usar

1. Haz clic en el botón "✎ SeoEditor" (esquina inferior derecha) para activar el modo edición.
2. Pasa el mouse para resaltar texto editable; haz click para abrir el editor inline.
3. La barra de herramientas permite: selección de fuente (mirror local + `@fontsource`), tamaño, peso, cursiva, subrayado, tachado, alineación, mayúsculas/minúsculas, sombra, espaciado entre letras, interlineado, color de texto y color de fondo.
4. Al guardar (click fuera, Escape, o "✓ Guardar y copiar"), SeoEditor intenta aplicar el cambio al código fuente. Un toast confirma qué se escribió y dónde, o por qué no se pudo.

Qué modifica en el código (reglas resumidas)

- Texto: busca el texto exacto en archivos `.tsx/.ts/.jsx/.js` (excluye `node_modules`, `.next`, `.git`, `dev-fonts`, `_archive`). Si aparece exactamente una vez en un archivo, lo reemplaza allí.
- Estilo: parsea el `.tsx/.jsx` con Babel y busca la etiqueta JSX cuyo contenido de texto coincide con el original; si la encuentra, mergea/inserta `style={{...}}` en esa etiqueta.
- Seguridad: si el texto viene de datos compartidos (por ejemplo, `lib/*.ts` o un array usado en múltiples páginas), SeoEditor se niega a escribir el estilo automáticamente — esto evita cambios globales no deseados.
- Ambigüedad: si el texto aparece 0 veces o más de una vez, o si el cambio no es seguro, SeoEditor no modifica archivos sino que copia una nota al portapapeles y guarda un registro en `logs/<project-slug>.jsonl` para aplicar los cambios manualmente.

Endpoints principales

| Ruta | Método | Descripción |
|---|---:|---|
| `/devtext.js?projectPath=...` | GET | Sirve el script del overlay |
| `/api/fonts?q=...` | GET | Busca en el mirror local de Google Fonts |
| `/api/fonts?family=slug` | GET | Descarga archivos de una familia |
| `/api/fontsource` | GET/POST | Consulta/instala `@fontsource/<slug>` en el proyecto vía `npm install` |
| `/api/apply-text` | POST | `{projectPath, originalText, newText}` — reemplazo de texto en el código |
| `/api/apply-style` | POST | `{projectPath, originalText, cssStyle}` — inyecta/mergea `style={{...}}` en el JSX |
| `/api/edit-log` | GET/POST | Historial de cambios por proyecto (`logs/<slug>.jsonl`) |

Seguridad y buenas prácticas (leer antes de usar)

- Revisa el repositorio local por secretos antes de conectar SeoEditor. No uses esta herramienta en repositorios con claves o tokens expuestos.
- SeoEditor no debe usarse sobre código de producción en vivo. Úsalo en entornos de desarrollo locales o branches de trabajo.
- Si detectas que un cambio afectaría a datos compartidos (ej. strings renderizados desde `lib/` o un JSON común), aplica el cambio manualmente con la información guardada en `logs/`.
- Si necesitas eliminar secretos del historial antes de hacer público el repo, usa `git filter-repo` o BFG. Pregunta y te doy los comandos.

Cómo ayudar a que este proyecto sea público y útil

Si quieres que este repositorio se vuelva público y útil para otros editores/redactores, te propongo lo siguiente (puedo crear una issue con esta checklist si quieres):

- [ ] Renombrar el repositorio a `SeoEditor` (esto se hace en Settings → Repository name en GitHub o con `gh repo rename`).
- [ ] Actualizar package.json / metadata del proyecto (`name`, `description`, `homepage`).
- [ ] Añadir LICENSE (por ejemplo MIT) si quieres que sea open source.
- [ ] Auditar el historial por secretos y limpiarlos si existen.
- [ ] Añadir ejemplos de integración en proyectos Next.js minimal (ej.: `examples/nextjs-demo`).
- [ ] Escribir una guía rápida (Getting Started) con screenshots y GIFs.
- [ ] Añadir tests básicos y CI (GitHub Actions) que verifiquen endpoints clave.

Cómo renombrar el repo en GitHub (manual)

1. Abre https://github.com/mrallanodreman/devtext
2. Ve a Settings → Repository name → cambia a `SeoEditor` y confirma.

Con GitHub CLI:

```bash
gh repo rename mrallanodreman/devtext --new-name SeoEditor
```

Cómo cambiar visibilidad a pública (manual)

1. Ve a Settings → Danger Zone → Change repository visibility → Make public → confirma.

Con GitHub CLI:

```bash
gh repo edit mrallanodreman/devtext --visibility public
```

Siguientes pasos que puedo hacer ahora

- Puedo crear una issue en este repo con la checklist para hacer público y los pasos de auditoría (¿lo deseas?).
- Puedo actualizar package.json y otros metadatos si me das permiso o confirmas los cambios que quieres.
- Puedo añadir un ejemplo minimal en `examples/nextjs-demo` e instrucciones paso a paso.

Si quieres, procedo a crear la issue de checklist y a subir un ejemplo mínimo ahora. Si prefieres que primero renombremos el repo en GitHub, dime y te doy el comando exacto y los riesgos a revisar antes de confirmar.
