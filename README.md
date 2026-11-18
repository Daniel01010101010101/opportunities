# OPORTUNIA RADAR

Radar personal de **concursos, sorteos, bonos, beneficios gratuitos, ofertas y subsidios en Colombia** (con foco en Bogotá).
Un motor en Python investiga fuentes públicas **cada 2 horas desde GitHub Actions**, verifica, deduplica y prioriza lo que
encuentra, y publica los resultados en una web estática (React) en **GitHub Pages**. No hay datos de demostración: todo lo
que aparece en la web proviene de una ejecución real del motor, con su fuente enlazada.

> La puntuación (0–100) indica **prioridad de revisión**, no probabilidad de ganar.

---

## 1. Arquitectura

```
GitHub Actions (cron "17 */2 * * *" UTC = :17 de cada hora impar en Bogotá, 24/7)
   │   también: botón «Run workflow» / «Investigar ahora» (por categoría o búsqueda libre) y push de código
   ▼
engine/ (Python)                                         rama radar-data (base de datos JSON + historial git)
 ├─ sources/   Bing Noticias RSS · GDELT · RSS oficiales ──►  data/opportunities.json  (activas + vencidas recientes)
 │             páginas oficiales de listados · Google CSE*    data/archive.json        (vencidas antiguas)
 │             · Brave Search*   (*opcionales con clave)      data/runs.json           (historial de ejecuciones)
 ├─ http.py    robots.txt, límite por dominio, reintentos,    data/sources.json        (salud de cada fuente)
 │             caché ETag, presupuesto de consultas y tiempo   data/changes.json        (cambios importantes)
 ├─ parse.py   HTML / PDF → texto, enlaces, listas de pasos    data/status.json         (estado global del motor)
 ├─ extract.py fechas en español, valores en COP, compra,     state/*.json             (caché, rotación, alertas)
 │             registro, redes, edad, cobertura, pasos…
 ├─ classify.py organizador (registro de dominios oficiales),
 │             sección, categoría, tipo de costo
 ├─ verify.py  dominio oficial, términos, fechas, enlace vivo,
 │             suplantación, pagos ocultos, datos sensibles
 ├─ dedupe.py  URL canónica + similitud de títulos
 ├─ score.py   prioridad 0-100 (alta / media / baja)
 ├─ llm.py     (opcional) extracción con Claude, sin inventar
 └─ notify.py  (opcional) Telegram / correo
   ▼
web/ (React + TypeScript + Vite + Tailwind + Lucide + Recharts) ──► GitHub Pages
   lee los JSON publicados; datos personales en localStorage
```

### Flujo de cada ejecución
1. Se activa el disparador (programado, manual o push).
2. Se eligen las fuentes que tocan según su frecuencia (`every_hours`); las que fallaron antes se reintentan siempre.
3. Se consultan en paralelo (si una falla, se registra el error y se sigue con las demás).
4. Se filtran candidatos: noticias de más de 30 días, resultados de loterías, notas sobre estafas, comunicados sin oportunidad…
5. Se descarga cada página (respetando `robots.txt`), se extraen los datos y, si es una noticia, se busca el **enlace oficial** del organizador.
6. Se clasifica, se evalúa el riesgo, se verifica y se calcula la prioridad.
7. Se compara con la base: duplicados se fusionan (conservando todas las fuentes), cambios importantes quedan en el historial.
8. Mantenimiento: se re-verifican enlaces antiguos, se marcan vencidas/retiradas, se recalculan prioridades y se archiva lo viejo.
9. Se guardan los JSON en la rama `radar-data`, se compila la web y se publica en GitHub Pages.
10. Si hay secretos de alertas, se envían por Telegram/correo las novedades relevantes.

---

## 2. Estructura del proyecto

```
.github/workflows/radar.yml        motor + publicación (cron cada 2 h, manual, push)
.github/workflows/radar-retry.yml  reintento automático de ejecuciones programadas fallidas
config/sources.yml                 fuentes iniciales (editable)
config/organizers.yml              organizadores y dominios oficiales; medios; hosts sospechosos
config/taxonomy.json               secciones, categorías, tipos de costo (compartido motor ↔ web)
config/alerts.json                 qué notificar por Telegram/correo
engine/radar/                      motor de investigación (Python 3.12)
engine/tests/                      pruebas (pytest)
web/src/                           frontend (React + TS)
  pages/  Radar, Section (concursos/bonos/ofertas/estado), SinComprar, Calendario, Mis, Alertas, Monitoreo, Buscar, Ajustes
  components/  Layout, OpportunityCard, OpportunityDetail (ficha «¿Cómo puedo ganar o reclamar?»), Explorer (filtros), Charts…
  lib/  data (carga de JSON), personal (localStorage), search (lenguaje natural), github (Actions), taxonomy, format
```

---

## 3. Fuentes conectadas

| Tipo | Fuentes | Clave |
|---|---|---|
| Noticias (descubrimiento) | Bing Noticias RSS con ~30 búsquedas: bonos de gasolina, Terpel, Primax, Biomax/Texaco, sorteos de carros/motos/viajes/tecnología, concursos gratis, supermercados, Black Friday, día sin IVA, bancos y billeteras (Bancolombia, Davivienda, Nequi, Daviplata, Nu, Dale, Movii), cashback, muestras, eventos y cine gratis, SENA, ICETEX, becas Bogotá, subsidios de vivienda, Prosperidad Social, Alcaldía de Bogotá, cajas de compensación, emprendimiento, cursos gratis, premios por registrarse | No |
| Noticias globales | GDELT DOC 2.0 (filtrado a Colombia y español) | No |
| RSS oficiales | Prosperidad Social, Bogotá.gov.co | No |
| Páginas oficiales | Terpel (términos de campañas), Primax (términos y PDF de promociones), Nequi (promociones), Bancolombia (ofertas), Ktronix, Idartes (agenda gratuita y convocatorias), ICETEX (becas), Minciencias (convocatorias), Cine Colombia, Colsubsidio, SENA Betowa | No |
| Buscadores con API | Google Programmable Search, Brave Search | Opcional |
| **Fuentes descubiertas** | Cada dominio oficial enlazado desde una noticia se registra automáticamente y aparece en *Monitoreo → Fuentes → Descubiertas* | — |

Organizadores reconocidos (para verificar dominios oficiales): combustibles (Terpel, Primax, Biomax, Texaco, Shell, Mobil…),
comercio (Éxito, Olímpica, Alkosto, Ktronix, Falabella, Homecenter, Ara, D1, Rappi, Mercado Libre…), bancos y billeteras,
telecomunicaciones, cines y boleterías, marcas de consumo, aerolíneas, marcas de carros y motos, cajas de compensación y
entidades públicas (SENA, ICETEX, Prosperidad Social, DNP, Alcaldía de Bogotá, Gobernación de Cundinamarca, ministerios…).
Cualquier dominio `.gov.co` se trata como oficial del Estado. Todo es editable en `config/`.

---

## 4. Clasificación, verificación y seguridad

**Prioridad 0–100** = valor (25) + gratuidad (25) + facilidad (15) + vigencia (10) + cobertura (10) + credibilidad (10) + claridad de términos (5).
*Alta* solo si es gratuita, verificada o pendiente, sin riesgo alto y ≥ 70. Las que requieren compra nunca son «alta».
Riesgo alto ⇒ máximo 20 puntos y nunca aparece como destacada.

**Tipos de costo**: 100 % gratis · gratis con registro · gratis con actividad · requiere compra · requiere suscripción ·
condiciones económicas (depósitos, saldo mínimo, inscripción con costo) · costo sin confirmar. Nada que exija compra o
depósito se presenta como gratuito. Cuando la gratuidad es *inferida* (página oficial sin ninguna condición de compra), se marca con «*».

**Estados de verificación**: verificada (dominio oficial + enlace activo + términos consultables, o programa público oficial) ·
pendiente · no verificable · vencida · retirada (la página indica cancelación o el enlace oficial da 404/410 dos veces seguidas).

**Detección de riesgos**: dominios que usan el nombre de una marca sin ser suyos (suplantación), hosting gratuito, acortadores,
dominios con terminaciones inusuales, «paga el envío para recibir tu premio», solicitudes de tarjeta/CVV/claves/OTP,
fotos de documentos, «ya ganaste», reclamos por WhatsApp. La web muestra advertencias claras.

**Nunca se inventan datos**: pasos, requisitos, valores y fechas solo se muestran si aparecen en la fuente; si falta algo, la ficha
dice «No informado por la fuente».

---

## 5. Automatización (GitHub Actions)

- `radar.yml` se ejecuta con `cron: '17 */2 * * *'` (UTC). Colombia es UTC-5 sin horario de verano: corre a las **:17 de cada hora impar en Bogotá**, 24/7. Todo el cálculo de fechas usa `TZ=America/Bogota`. GitHub puede retrasar las ejecuciones programadas algunos minutos en horas de alta carga.
- **Ejecución manual**: Actions → *Radar de oportunidades* → **Run workflow** (categoría, búsqueda libre, «todas las fuentes»), o desde la web con el botón **Investigar ahora** (requiere token, ver Ajustes).
- **Por categoría**: `concursos`, `bonos`, `ofertas`, `estado`, `gasolina`, `carros`, `motos`, `becas`, `formacion`, `vivienda`, `eventos_gratis`.
- **Reintentos**: 2 reintentos con backoff por petición; las fuentes fallidas se reintentan en la siguiente ejecución; `radar-retry.yml` relanza una vez una ejecución programada que falle.
- **Límites y consumo**: máx. 320 peticiones y 25 min por ejecución (`RADAR_MAX_FETCHES`, `RADAR_MAX_RUNTIME_S`), 1,2 s mínimo entre peticiones al mismo dominio, `Crawl-delay` respetado, caché condicional (ETag/Last-Modified) y caché negativa de 10 días para enlaces descartados.
- **Historial**: cada ejecución queda en `data/runs.json` (fecha, hora, disparador, fuentes, nuevas, actualizadas, descartadas con motivos, errores, duración, estado) y en el historial de commits de la rama `radar-data`.

---

## 6. GitHub Pages

- Settings → **Pages** → Source: **GitHub Actions** (ya configurado). El sitio queda en `https://<usuario>.github.io/<repositorio>/`.
- El entorno `github-pages` solo permite publicar desde **`main`** (regla creada por GitHub al activar Pages). Por eso:
  - el trabajo `deploy` solo corre en `main`;
  - si una búsqueda corre en otra rama (por ejemplo, la rama por defecto actual), al terminar guarda los datos en `radar-data`
    y **lanza automáticamente** una ejecución `mode=publicar` en `main`, que compila el sitio con esos datos y lo publica.
- Recomendado (opcional): Settings → General → **Default branch** → `main`. Así las búsquedas programadas corren directamente
  en `main` y no hace falta el paso intermedio. Todo sigue funcionando igual si no lo cambias.
- Publicación manual: Actions → *Radar de oportunidades* → **Run workflow** → rama `main` → `mode: publicar` (o `buscar`).

## 7. Variables y secretos (todos opcionales)

El radar **funciona sin ninguna clave**. Estos secretos (Settings → Secrets and variables → Actions) activan funciones extra:

| Secreto / variable | Para qué | Costo |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alertas por Telegram | Gratis |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `ALERT_EMAIL_TO`, `SMTP_PORT` (465 por defecto) | Alertas por correo (p. ej. Gmail con contraseña de aplicación) | Gratis |
| `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` | Búsqueda web con Google Programmable Search | 100 consultas/día gratis |
| `BRAVE_API_KEY` | Búsqueda web con Brave Search API | Plan gratuito limitado |
| `ANTHROPIC_API_KEY` | Extracción con IA (Claude): pasos, requisitos y traducción al español más precisos, siempre solo desde el texto de la fuente | **De pago por uso.** Modelo por defecto `claude-opus-5-5` (USD 4 / 20 por millón de tokens de entrada / salida): ≈ USD 0,02–0,04 por oportunidad nueva. Límite `LLM_MAX_ITEMS_PER_RUN` (variable, 12 por defecto) y caché por contenido. Con la variable `ANTHROPIC_MODEL=claude-haiku-5-5` el costo baja ~40 veces |
| Variable `ANTHROPIC_MODEL`, `LLM_MAX_ITEMS_PER_RUN` | Modelo y tope de llamadas por ejecución | — |

La IA usa el respaldo automático del servidor (`fallbacks: "default"`) si el modelo rechaza una petición.
Ningún token se expone en el frontend. El token opcional de GitHub para «Investigar ahora» se guarda solo en el navegador del usuario.

---

## 8. Funciones personales

Favoritas, *Quiero participar*, *Participando*, *Por reclamar*, *Ganados*, *Descartados*, checklist por pasos (incluidos pasos
propios), notas y premio ganado. El estado lo marca el usuario (visitar un enlace no cuenta como participación). Se guarda en
`localStorage` detrás de una interfaz `PersonalBackend` (`web/src/lib/personal.tsx`) lista para conectar sincronización
(Gist privado o Supabase). Mientras tanto: **Ajustes → Exportar / Importar respaldo** para pasar los datos a otro dispositivo.

---

## 9. Desarrollo local

```bash
# motor
python -m venv .venv && . .venv/bin/activate
pip install -r engine/requirements-dev.txt
cd engine && python -m pytest -q tests
python -m radar run --full            # guarda en .radar-local/data y .radar-local/state

# web
cd web && npm ci
mkdir -p public/data && cp ../.radar-local/data/*.json public/data/ && cp ../config/alerts.json public/data/alerts-config.json
npm run dev
```

---

## 10. Limitaciones reales

- **Redes sociales** (Instagram, Facebook, TikTok, X, YouTube): no se consultan directamente porque exigen inicio de sesión o APIs de pago y sus condiciones prohíben la extracción automática. Los concursos de redes llegan al radar cuando aparecen en noticias o en páginas oficiales.
- **Sitios con JavaScript o bloqueo de bots** (p. ej. Éxito, Davivienda, BBVA, Tigo, Biomax devuelven 403 o contenido vacío; Banco de Bogotá prohíbe el acceso en `robots.txt`): se respetan; esas marcas se cubren vía noticias y búsquedas. No se evaden CAPTCHAs ni protecciones.
- **Google Noticias RSS** no se usa porque sus enlaces no exponen la URL real del artículo; **Bing Noticias RSS** devuelve pocos resultados recientes por consulta, por eso hay muchas búsquedas en rotación. Sus condiciones permiten uso personal no comercial en lectores de feeds.
- **GDELT** limita fuertemente las consultas (HTTP 429); cuando ocurre, se registra y se reintenta en la siguiente ejecución.
- **Extracción sin IA**: las reglas encuentran fechas, valores, condiciones y listas de pasos cuando están en el HTML/PDF; si la página no los publica de forma estructurada, la ficha lo dice. Con `ANTHROPIC_API_KEY` la extracción mejora.
- **Traducción**: sin IA, el contenido en otro idioma se muestra en su idioma original con el aviso correspondiente (casi todas las fuentes son en español).
- **Cobertura de concursos**: depende de lo que publiquen medios y marcas en cada momento; el radar crece con cada ejecución y con las fuentes que descubre.
- **Valor de premios**: solo se muestra si la fuente lo publica; las probabilidades de ganar solo si están publicadas oficialmente.
- **Programación**: GitHub puede retrasar los cron en horas pico y desactiva workflows programados tras 60 días sin actividad en el repositorio (los commits de datos cada 2 h mantienen la actividad; si ocurriera, basta con reactivarlo en Actions).
- **Sincronización entre dispositivos**: hoy por exportar/importar; requiere un backend (Gist/Supabase) para hacerlo automático.
