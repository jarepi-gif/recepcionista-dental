# Aura: atención y conversión — 3 octubre 2026

## Respaldo previo
Versión activa previa: c4c569799724a869d839bea76f7e10d5fe038b3c.
Archivo: Aura_respaldo_2026-10-03_c4c5697.zip. SHA256: 2d65414e112a14005a4c1392fcfc8a8186b3b074315d9402c4df7f62ed9c8298.
Rama remota de recuperación: respaldo-aura-20261003.
El ZIP conserva los archivos versionados del repositorio. Las credenciales y registros de Twilio no están incluidos; permanecen en sus servicios existentes. Para restaurar código, revertir este cambio y desplegar; no eliminar documentos ni variables del servicio.

## Comportamiento
- Conserva necesidad, dientes declarados y datos de solicitud en el documento de conversación de Twilio Sync.
- Solicitudes pendientes con responsable y objetivo de diez minutos durante atención L–V 11–18, sábado 11–15. Fuera de horario, objetivo desde la próxima apertura. Es un objetivo operativo; no una garantía de respuesta humana.
- No existe conexión de Dentalink ni agenda real: no ofrece horas disponibles ni confirma por sí sola. La confirmación manual exige fecha y evidencia de agenda.
- Seguimiento propuesto con fecha dentro del horario de atención, registrado al aceptar. La bandeja permite completar, registrar o marcar atendido el acuerdo. No hay un nuevo envío automático al paciente ni un trabajador de mensajes programados. La ventana de WhatsApp de 24 horas se conserva.
- Avisos de tareas vencidas con página abierta y avisos activados. Se mantienen Web Push y alertas existentes al WhatsApp del doctor por nuevos contactos/solicitudes. No se programan alertas de tareas en segundo plano.
- Primera explicación del Paquete Básico Inicial conserva nueve componentes y $1,500, distinguidos del tratamiento. No inventa anticipos, descuentos ni un paquete para dos dientes.
- Mapa de búsqueda por dirección oficial, no pin geográfico certificado: https://www.google.com/maps/search/?api=1&query=Plaza%20Centtral%2C%20Blvd.%20Palmas%20Hills%201%2C%20Villa%20de%20las%20Palmas%2C%2052787%2C%20Naucalpan%20de%20Ju%C3%A1rez%2C%20Estado%20de%20M%C3%A9xico
- Ficha comercial: clasificación, posibilidad de acudir, necesidad, origen/evidencia, responsable, obstáculo, seguimiento, solicitud, cita confirmada, asistencia, aceptación y cobros con folio/comprobante. No registra un pago sólo porque el paciente lo afirme. Folios repetidos no se suman dos veces.
- Resumen excluye pruebas, proveedores y duplicados clasificados; no reconstruye resultados históricos ni valida documentos bancarios. Fichas y origen sin confirmar no deben considerarse totales completos.
- Atribución Meta sólo cuando Twilio proporciona ReferralSourceId; conserva cuerpo, título y referencia del anuncio. Un saludo genérico no prueba Meta. Una referencia THERA sin resolución conserva origen desconocido.
- Procesamiento serial por teléfono evita perder contexto en webhooks concurrentes; no agrupa mensajes ni garantiza exactamente un envío si el proveedor repite una entrega.

## Revisión de anuncios, sólo lectura
Windsor.ai, cuenta Meta 1065245195883802, periodo 28 septiembre–1 octubre 2026.
Campaña mensajes: $1,132.61 MXN consumidos. AD2, AdSet 2, id 120251796848220744: $1,047.83 (92.5% aprox.); texto menciona diagnóstico inicial de $1,500 y no Interlomas.
Otras piezas mencionan “cero margen de error” o resultados “100% natural”: Aura no debe repetir esas garantías. Queda pendiente comprobar imagen/video y asociación individual de contactos históricos; el PDF solo no prueba cuál anuncio recibió Salvador.
La segmentación consultada usa lugares Paseo Interlomas y Centtral Interlomas con radios de 5 km, y location_types frequently_in/home/recent. No certifica domicilio de pacientes. El punto Centtral recibido del conector requiere contrastarse con ubicación real antes de proponer cambios. No se modificó Meta, campañas, segmentación, presupuestos ni se enviaron conversiones de prueba.

## Validación
69 pruebas automatizadas: contexto de cita, nombre y teléfono en un mismo mensaje, precio de uno/dos dientes, ubicación/distancia, tercera persona, seguimiento aceptado/rechazado, horario, atribución, evidencia de cita/cobro y exclusiones. Se incluyó prueba HTTP del servidor con credenciales ficticias, sin envíos a pacientes.
