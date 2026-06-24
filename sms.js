const env = require('../config/env');
const logger = require('./logger');

/**
 * Sends an SMS via the configured provider. In development (or when
 * SMS_PROVIDER=console), the message is simply logged — handy for testing
 * OTP flows without a paid SMS account.
 */
async function sendSms(toPhone, message) {
  switch (env.SMS_PROVIDER) {
    case 'termii':
      return sendViaTermii(toPhone, message);
    case 'twilio':
      return sendViaTwilio(toPhone, message);
    case 'console':
    default:
      logger.info(`📱 [SMS:${toPhone}] ${message}`);
      return { provider: 'console', success: true };
  }
}

async function sendViaTermii(toPhone, message) {
  const res = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: toPhone.replace('+', ''),
      from: env.TERMII_SENDER_ID,
      sms: message,
      type: 'plain',
      channel: 'generic',
      api_key: env.TERMII_API_KEY,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    logger.error('Termii SMS failed', data);
    throw new Error('Failed to send SMS via Termii');
  }
  return { provider: 'termii', success: true, data };
}

async function sendViaTwilio(toPhone, message) {
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toPhone, From: env.TWILIO_FROM_NUMBER, Body: message }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    logger.error('Twilio SMS failed', data);
    throw new Error('Failed to send SMS via Twilio');
  }
  return { provider: 'twilio', success: true, data };
}

module.exports = { sendSms };
