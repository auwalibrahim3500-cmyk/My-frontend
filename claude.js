const Anthropic = require('@anthropic-ai/sdk');
const env = require('../config/env');
const logger = require('./logger');

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

function assertConfigured() {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }
}

/**
 * Sends a crop photo + metadata to Claude for vision-based disease diagnosis.
 * Returns a structured JSON object (validated/defaulted) describing the result.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType e.g. 'image/jpeg'
 * @param {{cropLabel?: string}} meta
 */
async function diagnoseCropImage(imageBuffer, mimeType, meta = {}) {
  assertConfigured();

  const systemPrompt = `You are AgriGuard AI's crop disease diagnosis engine for Nigerian smallholder farmers.
Analyze the photo and respond with ONLY a JSON object (no markdown, no prose) matching this exact shape:
{
  "crop_label": string,            // e.g. "Maize"
  "disease_label": string,         // e.g. "Northern Corn Leaf Blight" or "Healthy" if no disease
  "confidence": number,            // 0-100
  "severity": "none"|"mild"|"moderate"|"severe",
  "hectares_affected_estimate": number|null,
  "description": string,           // 1-3 sentences, plain language
  "treatment_steps": string[],     // ordered, actionable steps using inputs available in Nigeria
  "prevention_tips": string[]
}
Be concise, practical, and specific to Nigerian farming conditions (locally available fungicides/pesticides, e.g. Mancozeb, Cypermethrin).`;

  const userText = meta.cropLabel
    ? `The farmer indicated this is a ${meta.cropLabel} plant. Diagnose any disease visible in the photo.`
    : 'Identify the crop and diagnose any disease visible in the photo.';

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBuffer.toString('base64') } },
          { type: 'text', text: userText },
        ],
      },
    ],
  });

  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n').trim();
  return parseJsonSafely(text);
}

/**
 * Sends a chat message (with prior history) to Claude and returns the assistant's reply.
 * @param {Array<{role:'user'|'assistant', content:string}>} history
 * @param {string} language 'en' | 'ha' | 'yo' | 'ig'
 */
async function getChatReply(history, language = 'en') {
  assertConfigured();

  const langInstruction = {
    en: 'Respond in clear, simple English.',
    ha: 'Respond primarily in English, but also include a short Hausa translation/summary at the end.',
    yo: 'Respond primarily in English, but also include a short Yoruba translation/summary at the end.',
    ig: 'Respond primarily in English, but also include a short Igbo translation/summary at the end.',
  }[language] || 'Respond in clear, simple English.';

  const systemPrompt = `You are AgriGuard AI, a friendly farm assistant helping Nigerian smallholder farmers with crop diseases, fertilizer use, weather-based decisions, market prices, and general agronomy advice. Keep answers practical, concise (use short paragraphs or bullet points), and reference locally available inputs where relevant. ${langInstruction}`;

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  return response.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n').trim();
}

/**
 * Handles a transcribed voice query (speech-to-text already done client-side or via a
 * separate ASR step) and returns a spoken-style response in the requested language.
 */
async function getVoiceReply(transcript, language = 'ha') {
  assertConfigured();

  const systemPrompt = `You are Muryar AI, the voice assistant of AgriGuard for Nigerian farmers. The user spoke a question (transcribed below) in ${language === 'ha' ? 'Hausa' : 'English'}. Reply in ${language === 'ha' ? 'Hausa, with a short English translation after it' : 'English'}. Keep the answer short (2-4 sentences) since it will be read aloud, practical, and farmer-friendly.`;

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: transcript }],
  });

  return response.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n').trim();
}

function parseJsonSafely(text) {
  let cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    logger.warn('Claude diagnosis response was not valid JSON, attempting extraction.', text);
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_) { /* fall through */ }
    }
    throw new Error('AI diagnosis response could not be parsed.');
  }
}

module.exports = { diagnoseCropImage, getChatReply, getVoiceReply };
