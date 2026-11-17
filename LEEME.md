# Snowy — cómo ponerlo en línea (≈ 30 minutos, gratis)

Son 3 pasos grandes. Los archivos son estos:

| Archivo | Para qué sirve | Dónde va |
|---|---|---|
| `index.html` | El sitio completo: página pública, seguimiento del cliente y panel del equipo | GitHub Pages |
| `config.js` | Una sola línea con la URL de tu servidor | GitHub Pages (junto a `index.html`) |
| `manifest.webmanifest`, `sw.js` | Hacen que se pueda **instalar como app** y abra rápido, incluso con mala señal | GitHub Pages (junto a `index.html`) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.svg` | El ícono de la app (copo de nieve y pala) | GitHub Pages (junto a `index.html`) |
| `Code.gs` | El servidor: guarda todo en TU hoja de Google | Google Apps Script (se pega, no se sube) |

`LEEME.md` es esta guía; no hace falta subirla a ningún lado. **Sube todos los archivos a la misma carpeta (la raíz del repositorio).**

---

## Si ya tenías la versión anterior (actualizar)

1. En Apps Script, **borra el código y pega el nuevo `Code.gs` completo**. Guarda.
2. Ejecuta **`setup`** otra vez. No borra nada: solo agrega la columna `tk` en `Leads` y la columna `zonas` en `Team`.
3. **Implementar → Administrar implementaciones → ✏ → Versión: Nueva versión → Implementar.** La URL no cambia.
4. En GitHub sube **todos** los archivos nuevos (reemplaza `index.html`). Listo.

Los leads viejos siguen ahí. Los que llegaron antes de actualizar no tienen enlace de seguimiento hasta que el equipo toca **Voy en camino** (entonces se les crea uno).

---

## Paso 1 — Crear el servidor (Google Sheets + Apps Script)

1. Entra a <https://sheets.google.com> con la cuenta de Google del negocio y crea una **hoja en blanco**. Ponle de nombre `Snowy`.
2. Menú **Extensiones → Apps Script**.
3. Borra lo que aparezca en el editor y **pega todo el contenido de `Code.gs`**. Guarda (icono del disquete).
4. A la izquierda, **Configuración del proyecto** (rueda dentada) → **Zona horaria** → `(GMT-06:00) America/Chicago`. Guarda.
5. Vuelve a **Editor**. Arriba, en el selector de funciones elige **`setup`** y pulsa **Ejecutar**.
   - Google pedirá permisos (hoja, Drive, correo). Es tu propio script, así que es normal que diga *"Google no ha verificado esta app"*: **Configuración avanzada → Ir a Snowy (no seguro) → Permitir**.
   - Al terminar crea las pestañas `Leads`, `Jobs`, `Team`, `Crew`, `Config` y la carpeta **"Snowy fotos"** en tu Drive.
6. Abre la pestaña **`Team`** de la hoja. Ahí están los nombres y los PIN de 6 dígitos que se generaron:

   | nombre | pin | rol | activo | zonas |
   |---|---|---|---|---|
   | Dueño | 482913 | owner | TRUE | |
   | Equipo 1 | … | crew | TRUE | Oeste, Norte |

   - **Cambia los nombres por los de tu gente** (máximo 4 filas) y, si quieres, los PIN.
   - **Ojo:** el cliente ve el nombre de quien va en camino (como en Uber). Si prefieres que no vea nombres reales, déjalos como `Equipo 1`, `Equipo 2`…
   - `owner` ve y cambia todo (ajustes, borrar, zona de cuidado). `crew` ve leads, se asigna trabajos, avisa al cliente, sube fotos y marca su estado.
   - **`zonas`** (opcional): las zonas que cubre cada persona, separadas por coma. Los nombres tienen que ser los mismos que pongas en *Ajustes → Zonas de trabajo* (más abajo).
   - Para dar de baja a alguien: pon `FALSE` en `activo`. Su sesión se cierra de inmediato.
   - El nombre no distingue mayúsculas. **No compartas esta hoja con nadie** (tiene los PIN y los datos de tus clientes).
7. Publica el servidor: **Implementar → Nueva implementación → ⚙ Aplicación web**.
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier persona**
   - **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).

> Cada vez que cambies `Code.gs` hay que volver a **Implementar → Administrar implementaciones → ✏ → Versión: Nueva versión → Implementar**. La URL no cambia.

## Paso 2 — Conectar el sitio con el servidor

Abre `config.js` y pega tu URL entre las comillas:

```js
window.SNOWY_API = "https://script.google.com/macros/s/XXXXXXXX/exec";
```

## Paso 3 — Publicar en GitHub Pages

1. Crea una cuenta en <https://github.com> y un repositorio **público** nuevo (por ejemplo `snowy`).
2. **Add file → Upload files** y sube **todos los archivos de la tabla de arriba menos `Code.gs`** (son `index.html`, `config.js`, `manifest.webmanifest`, `sw.js` y los 5 de íconos). **Commit changes**.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. En 1–2 minutos tu sitio queda en `https://TU-USUARIO.github.io/snowy/`. GitHub Pages usa HTTPS, que es lo que necesitan el botón **"Usar mi ubicación"**, la app instalable y el GPS del equipo.
5. (Opcional) Dominio propio, p. ej. `snowychicago.com`: Settings → Pages → Custom domain.

Para entrar al panel: toca **Equipo** en el pie de la página (o agrega `#panel` a la URL) y entra con tu nombre y PIN.

### Instalarlo como app en el teléfono (clientes y equipo)

- **Android (Chrome):** aparece **"Instalar la app"** en el pie de la página (y en la pantalla de seguimiento). Un toque y queda el ícono.
- **iPhone (Safari):** botón **Compartir → Agregar a pantalla de inicio**. La página lo recuerda al cliente con un aviso.
- Si algún día cambias el nombre de la marca a *iSnow*, edita también `name` y `short_name` en `manifest.webmanifest` y `apple-mobile-web-app-title` en `index.html`.

---

## Cómo lo usa el cliente (sin cuenta, sin contraseña)

1. Abre la página. Llena **nombre, teléfono y dirección** (se autocompleta o toca *Usar mi ubicación*), elige el servicio y para cuándo lo necesita. Lo demás está en *Más detalles (opcional)*.
2. Toca **Enviar solicitud**. **El lead llega al instante** al panel y por correo al dueño.
3. Ve su página de **seguimiento**: *Recibida → En camino → Trabajando → Listo*. Cuando el equipo sale, ve la cuenta regresiva (**"14 min, llega como a las 7:42 PM"**), la distancia y *En vivo* si el equipo comparte el GPS.
4. Si dejó correo, le llega un aviso al recibir la solicitud, cuando el equipo va en camino y cuando terminan, siempre con su enlace de seguimiento.
5. La próxima vez, sus datos ya están llenos ("Hola otra vez, Laura") y arriba ve **Tus solicitudes** con su estado. Un botón **"¿No eres tú? Borrar"** quita todo de ese teléfono.

**Esos datos se guardan solo en el teléfono del cliente.** No hay cuentas ni contraseñas: el enlace de seguimiento es un código secreto de 12 caracteres que solo recibe el cliente. Quien tenga el enlace ve el estado, pero **nunca** el teléfono, el correo ni la dirección completa del cliente.

## Cómo lo usa el equipo

Entra al panel → abre un lead → bloque **Seguimiento al cliente**:

1. **Voy en camino, llego en… 10 / 15 / 20 / 30 / 45 min** (un toque, sin GPS), **o** **"Salir con GPS"**: calcula el tiempo solo y comparte tu ubicación mientras vas.
2. **Llegué → Empecé a limpiar → Terminé.** Al tocar *Terminé* el lead pasa a *Completado*, tú quedas *Disponible* y el cliente ve el botón **Cómo pagar**.
3. **Enviar enlace por mensaje** abre tu app de mensajes con el texto y el enlace ya escritos. También puedes copiarlo.
4. En la lista de leads, los que tienes asignados traen un **botón rápido** con tu siguiente paso (*Voy en camino*, *Llegué*…), sin abrir el lead.
5. El lead nuevo **suena, vibra y aparece arriba** (y la pestaña muestra el número, p. ej. "(2) Panel"). En **Equipo → Avisos** puedes apagar el sonido o activar notificaciones del navegador.

### Zonas de trabajo

- *Ajustes → Zonas de trabajo*: una zona por línea, así: `Oeste: Oak Park, Berwyn, 60302`. Puedes usar ciudades y códigos postales.
- En la hoja `Team`, columna `zonas`, escribe qué zonas cubre cada quien.
- **Cliente:** al poner su dirección ve *"Zona: Oeste"*, y en la página pública ve *"Cubriendo hoy: Oeste · Norte"* (sin nombres).
- **Equipo:** en cada lead ve su zona y quién la cubre (★ en la lista de asignar).

## Primer día: configura y prueba (15 minutos)

1. Entra como **Dueño** → **Ajustes** y llena: teléfono, correo del negocio, **email para avisos de leads nuevos**, Zelle, $Cashtag, dirección de Bitcoin, seguro/licencia si tienes, **precios** y **zonas**.
2. Revisa el **centro y radio de servicio** (por defecto Chicago, 35 millas). El sitio avisa al cliente si su dirección queda fuera, pero igual le deja enviar la solicitud.
3. Manda un lead de prueba desde otro teléfono: debe llegar a `Leads`, al panel (con sonido) y a tu correo.
4. Abre ese lead, toca **Voy en camino 10 min** y mira en el teléfono del cliente cómo cambia su pantalla. Prueba también **Salir con GPS** (acepta el permiso de ubicación).
5. En **Equipo → Mi estado** marca *Trabajando* con una zona y la hora en que quedas libre: aparece en la página pública (sin nombres ni ubicación exacta).
6. En **Trabajos → + Nuevo trabajo** sube fotos de antes y después. Solo se publican si marcas que tienes permiso del cliente.

## Lo que hay que saber (límites honestos)

- **El GPS solo funciona con la página abierta y la pantalla encendida.** Los navegadores no dejan rastrear la ubicación con la app cerrada. Al compartir, el teléfono intenta mantener la pantalla encendida (en los que lo permiten); si la bloqueas, el cliente deja de ver *En vivo* (sigue viendo la cuenta regresiva) y se retoma al volver a abrir. Ponlo en un soporte y listo.
- **El tiempo con GPS es una estimación** (distancia en línea recta × 1.3, a 18 mph). No usa tráfico real. Si ves que no coincide, corrígelo con los botones de minutos.
- **No hay notificaciones "push" con la app cerrada.** Los avisos de lead nuevo funcionan con el panel abierto (se revisa cada 15 segundos). Si llenaste el **Email para avisos** en Ajustes, el correo llega aunque nadie tenga el panel abierto. Si algún día quieres push de verdad con la app cerrada, hay que sumar un servicio (p. ej. Firebase); se puede después.
- **Los mensajes de texto no se mandan solos**: el botón abre tu app de mensajes y tú das enviar. (Mandarlos automático requiere un servicio de pago como Twilio.)
- **Correos:** el cliente solo recibe correos si dejó su email. Las cuentas gratuitas de Google envían unos 100 al día desde Apps Script (contando también los avisos al dueño).
- **La ubicación del equipo nunca se guarda**: vive 15 minutos en memoria temporal del servidor y desaparece. En la hoja solo queda la etapa (*en camino*, *llegué*…) y el tiempo.
- **Uso del servidor:** la pantalla de seguimiento consulta cada 10 segundos y el panel cada 15. Para 3–4 personas y los clientes de un negocio que empieza, es poco. Google no publica un tope diario claro para aplicaciones web; si algún día ves errores de "servicio no disponible" en horas pico, es la señal de que hay que pasar el servidor a uno propio.
- **Etapas colgadas:** si alguien olvida tocar *Terminé*, después de 6 horas el cliente deja de ver *En camino* y vuelve a *Confirmada*.

## Cómo funciona la sincronización del equipo

El panel consulta el servidor cada 15 segundos y cada cambio se guarda al instante, así que 3–4 personas ven lo mismo casi en tiempo real. Si dos cambian el mismo campo a la vez, gana el último en guardar. Un estado de equipo con más de 14 horas deja de mostrarse al público.

## Qué ve el público y qué no

- **La página pública ve:** precios, clima, galería (solo trabajos con permiso), cuántas personas están trabajando/disponibles, las zonas que cubrimos hoy y la hora aproximada en que quedamos libres. **Nunca** nombres del equipo, notas, ubicación exacta, leads, PIN ni tu correo de avisos.
- **El cliente, en su enlace de seguimiento, ve:** su código, los servicios, el precio y lo pagado, el nombre de quien va en camino, el tiempo de llegada y la distancia. **Nunca** la ubicación exacta del equipo, ni los datos de contacto de nadie.
- **Ubicación (GPS) del cliente:** solo se guarda en su lead si toca *Usar mi ubicación* o elige una dirección sugerida, y sirve para el botón *Cómo llegar* y para calcular el tiempo.

## Servicios externos que usa (y sus límites)

| Servicio | Para qué | Costo / condiciones |
|---|---|---|
| **National Weather Service** (api.weather.gov) | Clima, pronóstico de nieve y alertas | Gratis, datos públicos de EE. UU., uso comercial permitido |
| **Photon / OpenStreetMap** | Autocompletar dirección, "Usar mi ubicación" y ubicar leads para el tiempo de llegada | Gratis con uso razonable, sin garantía de disponibilidad. Si algún día crece mucho, se cambia por Google Places (requiere clave y facturación) |
| **Google Maps** (solo enlaces) | "Mapa" y "Cómo llegar" | Gratis, abre la app de mapas |
| **Google Drive** | Fotos de trabajos | Cuenta gratuita de Google |

Si Photon falla, el cliente puede escribir la dirección a mano y todo sigue funcionando (solo se pierde el tiempo automático con GPS: usa los botones de minutos). Si el clima falla, la página muestra un aviso y el resto sigue igual.

## Problemas frecuentes

- **El panel dice que no hay conexión / el formulario ofrece "enviar por mensaje":** la URL de `config.js` está mal, o el servidor no se publicó con *Cualquier persona*, o falta **Nueva versión** después de editar `Code.gs`. Prueba abrir `TU_URL/exec?action=ping` en el navegador: debe responder `{"ok":true,...}`.
- **El cliente no ve la pantalla de seguimiento después de enviar:** casi siempre es que el servidor viejo no tiene la **Nueva versión** publicada. Sin ella el formulario funciona pero no devuelve el código de seguimiento.
- **No aparece "Instalar la app":** hace falta HTTPS (GitHub Pages lo trae) y que estén subidos `manifest.webmanifest`, `sw.js` y los íconos. En iPhone se instala desde Compartir.
- **Subí una versión nueva y no cambia:** cierra y abre la app (el sitio siempre busca la versión nueva primero). Si sigue igual, recarga con Ctrl+Shift+R.
- **No llegan los correos de aviso:** revisa spam y el campo *Email para avisos* en Ajustes. Ver el límite de ~100 al día.
- **Las fotos no se ven en la página pública:** con cuentas de Google Workspace, el administrador puede bloquear compartir por enlace fuera de la organización. Usa una cuenta Gmail normal para el negocio.
- **"Sesión vencida":** las sesiones duran 12 horas. Entra otra vez con tu PIN.
- **Cinco PIN incorrectos seguidos** bloquean ese nombre durante 15 minutos.
- **Quiero reiniciar todo:** borra las filas de datos (no los encabezados) de `Leads`, `Jobs` y `Crew`. No borres `Config` a menos que quieras volver a los ajustes de fábrica.
- **Privacidad legal:** los datos de tus clientes (nombre, teléfono, dirección) quedan en tu hoja. Si publicas fotos, tener permiso por escrito o por mensaje del cliente te protege.
