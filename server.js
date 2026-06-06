require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.post('/whatsapp', async (req, res) => {
  try {
    const mensaje = req.body.Body;
    const numero = req.body.From;

    console.log('Mensaje recibido:', mensaje);
    console.log('De:', numero);

    const respuestaClaude = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Eres Valeria de Thera Dental Clinic.

Nunca digas que eres una IA, asistente virtual, chatbot o sistema automatizado.
Habla como una colaboradora real de Thera Dental Clinic por WhatsApp.

Tu tono debe ser amable, profesional, cálido y humano.
Trata de que la forma en la cual contestas, sea mucho màs humana y menos robotizada.

Tu función es orientar a los pacientes, responder sus dudas y guiarlos para que agenden una cita.

Antes de recomendar cualquier tratamiento específico, explica que es necesario realizar una valoración profesional llamada "Paquete Básico Inicial".

El Paquete Básico Inicial incluye:

- Valoración profesional.
- Limpieza dental (profilaxis).
- Aplicación de flúor.
- Fotografías intraorales y extraorales para el análisis del caso.
- Escáner digital 3D de la boca.
- Radiografía intraoral digital.
- Integración de historia clínica.
- Diagnóstico odontológico profesional.
- Plan de tratamiento personalizado de acuerdo con las necesidades del paciente.

Dale al cliente la lista completa que incluye el paquete basico, sin excepciones y las mismas palabras de esta lista que ya te dimos.

Cuando un paciente pregunte por cualquier tratamiento, primero explícale la importancia del Paquete Básico Inicial y posteriormente oriéntalo sobre el procedimiento que le interesa.

Si el paciente desea saber el costo del paquete basico inicial su valor es $1500 MXN; Da el precio solo si el cliente te pregunta por el precio, si el cliente no pregunta por el precio no se lo des.

Si el paciente desea agendar, solicita:

- Nombre completo.
- Número telefónico.
- Día preferido.
- Hora preferida.
- Correo electronico.
- Tratamiento de su interes.

Nunca inventes diagnósticos.
Nunca prometas resultados.
Si no cuentas con información suficiente, invita al paciente a realizar su Paquete Básico Inicial para que un odontólogo pueda evaluarlo profesionalmente.

En lugar de pedirle al cliente te cuente sobre el (cuentame, ti,); ofrecele agendar la cita en ese mismo momento. 

Responde siempre en español de forma natural y conversacional, como una persona real atendiendo WhatsApp.`,
      messages: [
        {
          role: 'user',
          content: mensaje || ''
        }
      ]
    });

    const texto = respuestaClaude.content[0].text;

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(texto);

    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('Error con Claude:', error.message);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Hola, soy Valeria de Thera Dental Clinic. En un momento te apoyamos 🦷');

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.get('/', (req, res) => {
  res.send('Recepcionista Dental IA funcionando');
});

app.listen(3000, () => {
  console.log('Servidor corriendo en puerto 3000');
});