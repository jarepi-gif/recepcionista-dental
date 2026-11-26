# Consumo de Sync: primera fase

## Cambio

Se reutiliza la revisión del documento dentro de una operación para evitar el
`fetch` inmediatamente anterior a un `update`. No se conserva una caché entre
solicitudes, pacientes ni ejecuciones del seguimiento. Cada actualización sigue
enviando `ifMatch`; ante un conflicto 412 se consulta el estado actual y se
recalcula la actualización. La revisión devuelta por el proveedor alimenta la
siguiente actualización de esa misma operación.

Aplicado a la reparación de la ventana de atención, las actualizaciones de un
caso durante el seguimiento y la inscripción/reprogramación por mensaje entrante.
La lectura final antes de responder como Aura y la comprobación previa al envío
del seguimiento se mantienen. Un cambio a atención humana durante un conflicto
también cancela el seguimiento antes de enviar.

En escenarios sin conflictos, comprobados con documentos simulados:

| Operación | Lecturas del documento antes | Después |
| --- | ---: | ---: |
| Reparar fecha de último mensaje recibido | 2 | 1 |
| Inscribir seguimiento desde mensaje entrante | 2 | 1 |
| Ejecutar seguimiento dentro de la ventana | 4 | 2 |

Estos números excluyen configuración, listas, reservas de envío y llamadas de
mensajería. No representan una reducción del 50% de la factura completa.
Se mantienen la frecuencia de consulta de la bandeja y el intervalo del seguimiento.

## Medición

`sync-usage.js` instrumenta `client.request` del SDK de Twilio compartido por la
bandeja. Cada página de una lista se cuenta por separado. Una vez por minuto
emite `AURA_SYNC_USAGE` con ventana UTC y filas con:

- `process`: `aura.inbound`, `recovery.tick`, `recovery.api`, `inbox.list`,
  `inbox.messages`, `inbox.send`, `inbox.mode`, `inbox.other` o `background.other`.
- `operation`: familia del recurso y acción (`documents.fetch`, `documents.list`,
  `documents.create`, `documents.update`, `documents.delete` u otras).
- `sdkRequests`: invocaciones terminadas al SDK, incluidas las que fallan.
- `errors`: errores HTTP o rechazos; `durationMs`: duración acumulada.

Las tareas de arranque sin un contexto HTTP se atribuyen a `background.other`.
Las notificaciones y alertas iniciadas por un mensaje heredan `aura.inbound`.
Los contextos asíncronos se aíslan incluso cuando coinciden procesos en el tiempo.
No se guardan teléfonos, identificadores, URL, mensajes, credenciales ni respuestas.
La telemetría se escribe en logs; no genera operaciones adicionales en Sync.
Al recibir SIGTERM se intenta vaciar el último lote sin interrumpir el cierre normal.

**Unidad:** solicitudes del SDK, no dólares ni unidades facturables certificadas.
Un eventual reintento interno del transporte puede no aparecer por separado.
Los contadores son locales a cada instancia y no tienen persistencia; un cierre
abrupto puede perder el último minuto. No sustituyen la factura de Twilio.

Para la conciliación posterior, agrupar las filas por proceso y operación en el
mismo período UTC de Twilio; contrastar la suma con sus métricas de uso. No
convertir automáticamente estos contadores a USD ni atribuir retrospectivamente
los USD 246.18 a un proceso sin evidencia del proveedor.

## Validación y despliegue

Ejecutar `npm install --ignore-scripts --no-audit --no-fund` y `npm test`.
Las pruebas usan datos sintéticos y proveedores simulados: respuesta de Aura,
toma de control humano, ventana de 24 horas, consentimiento, seguimiento acordado,
conflictos de revisión, cancelación antes del envío y reservas que impiden repetir
un envío incierto. La instrumentación también se prueba contra el SDK real con
transporte simulado, incluyendo paginación, errores y concurrencia.

Después del despliegue, verificar `/health`, la versión desplegada y la aparición
de `AURA_SYNC_USAGE` durante actividad normal. Los ahorros reales solo se podrán
confirmar con uso posterior comparable. Para revertir, desplegar el commit anterior;
no hay migraciones ni cambios de esquema.
