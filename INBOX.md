# Bandeja Thera

Ruta: `/bandeja`. Historial y estados se leen del proveedor Twilio, sin depender de XimGrowthOS. La identidad enviada por WhatsApp es un nombre de perfil; un nombre completo declarado a Aura lo sustituye.

## Configuración

- `INBOX_ENABLED=true`
- `INBOX_PUBLIC_URL`: origen HTTPS de este servicio; debe coincidir exactamente con el origen del webhook configurado en Twilio.
- `INBOX_SECRET`: secreto aleatorio de al menos 32 caracteres, usado para iniciar sesión y firmar cookies. No guardar en el repositorio.
- Reutiliza `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`.

El servicio predeterminado de Twilio Sync conserva los documentos `thera-inbox-*` (teléfono, nombre, modo y último ingreso), sin TTL. Twilio Messaging conserva el historial conforme a su política de retención; la aplicación no constituye un expediente clínico ni un archivo ilimitado. Twilio Sync puede generar consumo facturable según el plan del proveedor.

## Operación

Recuperar recientes examina los últimos 200 mensajes recibidos por el número oficial; no envía mensajes ni genera conversiones. Cada conversación muestra hasta 100 mensajes por dirección y los estados actuales de Twilio. Las salidas históricas que no cuentan con un registro de envío humano se presentan como automatización; no es posible identificar retrospectivamente al autor de cada salida que haya generado otro sistema.

Tomar conversación guarda `mode=human` antes de confirmar al navegador. Cada respuesta de Aura vuelve a consultar ese modo antes de devolver TwiML. Los mensajes que Twilio ya haya aceptado antes de tomar el control pueden llegar después. Una sola instancia de Render es requisito para serializar respuestas y cambios de modo dentro de la instancia; no escalar sin implementar un bloqueo distribuido.

El modo humano impide las respuestas de Aura al webhook. No controla envíos externos originados por XimGrowthOS u otras aplicaciones: estos deben revisarse por separado antes de declarar que toda automatización de la cuenta está detenida. La integración existente con Xim se conserva cuando Aura está activa.

La respuesta manual requiere un mensaje entrante dentro de las últimas 24 horas. No incluye creación o envío de plantillas. Las claves de idempotencia bloquean reintentos de un mismo envío durante 48 horas, incluso si la respuesta del proveedor fue incierta. Antes de reescribir un envío fallido se debe consultar el historial.

La coordinación de citas permanece en el chat oficial; el equipo humano confirma disponibilidad desde la bandeja. Aura no envía al paciente al número personal del doctor. Las alertas comerciales siguen usando el destinatario interno configurado; incluyen `?phone=` para abrir el hilo específico. El endpoint administrativo de plantillas permite solicitar una plantilla de alertas sin la frase fija de Xim; se selecciona sólo después de aprobación. Durante la revisión se conserva la plantilla aprobada anterior para no interrumpir las alertas. La reparación administrativa de nombres sustituye frases informativas mal clasificadas por “Nombre por confirmar”, sin modificar el historial de mensajes.

Actualiza cada 10 segundos mientras la pestaña está visible. Archivos disponibles se descargan desde un proxy autenticado. Acceso con cookie HttpOnly, Secure, SameSite=Strict; duración 12 horas. El fragmento `#access=` permite iniciar sesión con un enlace privado y se borra inmediatamente del historial del navegador. No compartir el enlace de acceso.

## Recuperación

Para desactivar la bandeja y restaurar el camino anterior del webhook: `INBOX_ENABLED=false`, guardar variables y desplegar. No borra mensajes en Twilio ni los documentos de Sync. Con la bandeja activada, la firma de Twilio es obligatoria; una indisponibilidad de Sync responde 503 y evita que Aura conteste ignorando una pausa humana.

Antes de cerrar la entrega se debe realizar una prueba real desde WhatsApp: ingreso → respuesta de Aura visible → tomar control → respuesta humana entregada → nuevo ingreso sin respuesta automática → devolver a Aura → nuevo ingreso atendido.
