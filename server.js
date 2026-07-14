require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const fs = require('fs');

const app = express();
const historialConversaciones = {};
const estadoConversaciones = {};

const knowledge = JSON.parse(fs.readFileSync('./knowledge.json', 'utf8'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const auraPrompt = fs.readFileSync(
"./prompts/aura-2.0.md",
"utf8"
);

app.post('/whatsapp', async (req, res) => {
  try {
    const mensaje = req.body.Body;
    const numero = req.body.From;

if (!historialConversaciones[numero]) {
  historialConversaciones[numero] = [];
}
if (!estadoConversaciones[numero]) {
  estadoConversaciones[numero] = {
    paqueteExplicado: false
  };
}
historialConversaciones[numero].push({
  role: 'user',
  content: mensaje
});

// Mantener solo los Ãºltimos 7 mensajes para no gastar demasiado
historialConversaciones[numero] = historialConversaciones[numero].slice(-7);

    console.log('Mensaje recibido:', mensaje);
    console.log('De:', numero);

    
    const respuestaClaude = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 888,
    system: `${auraPrompt}

ESTADO DE LA CONVERSACIÓN:
El Paquete Básico Inicial ya fue explicado completamente: ${
  estadoConversaciones[numero].paqueteExplicado ? 'SÍ' : 'NO'
}.

Si el estado indica SÍ, no repitas la lista completa ni el precio del paquete, salvo que el paciente pregunte específicamente qué incluye, solicite que se repita o muestre confusión. Responde directamente la nueva pregunta del paciente.

INFORMACIÓN OFICIAL DE THERA DENTAL CLINIC:

${JSON.stringify(knowledge, null, 2)}`,
      messages: historialConversaciones[numero]
    });

    const texto = respuestaClaude.content[0].text;
if (
  texto.includes('El Paquete Básico Inicial incluye:') ||
  texto.includes('El Paquete Básico Inicial incluye')
) {
  estadoConversaciones[numero].paqueteExplicado = true;
}
    historialConversaciones[numero].push({
      role: 'assistant',
      content: texto
    });

    historialConversaciones[numero] =
      historialConversaciones[numero].slice(-8);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(texto);

    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('Error con Claude:', error.message);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Hola, soy Valeria de Thera Dental Clinic. En un momento te apoyamos ðŸ¦·');

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
