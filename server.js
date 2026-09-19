const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const QUICKLY_API_KEY = process.env.QUICKLY_API_KEY; // Add this variable in Railway
const QUICKLY_BASE_URL = process.env.QUICKLY_BASE_URL || 'https://quickly-production-b4f1.up.railway.app';
const MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Quickly Webhook:', JSON.stringify(payload, null, 2));

    // Handle test webhooks
    if (payload.event === 'test') {
      console.log('Test event received successfully.');
      return res.status(200).json({ status: 'ok', message: 'Test event received' });
    }

    // Handle lead replies
    if (payload.event === 'lead.replied') {
      const data = payload.data || {};
      const leadEmail = data.lead_email;
      const messageId = data.message_id;
      const threadId = data.thread_id;

      console.log(`Processing reply from ${leadEmail} (Thread: ${threadId})`);

      let leadMessageText = data.message || data.text;

      // If text isn't in payload, fetch thread/message from Quickly API
      if (!leadMessageText && messageId && QUICKLY_API_KEY) {
        try {
          const msgResponse = await fetch(`${QUICKLY_BASE_URL}/api/messages/${messageId}`, {
            headers: { 'Authorization': `Bearer ${QUICKLY_API_KEY}` }
          });
          if (msgResponse.ok) {
            const msgData = await msgResponse.json();
            leadMessageText = msgData.body || msgData.text;
          }
        } catch (fetchErr) {
          console.warn('Could not fetch message body from Quickly API:', fetchErr.message);
        }
      }

      // Default fallback prompt context if message body is unavailable
      const messageContext = leadMessageText || `The lead ${data.lead_name || leadEmail} replied to our campaign.`;

      // Call OpenRouter API
      const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://railway.app',
          'X-OpenRouter-Title': 'Quickly Webhook Reply Engine'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are an AI sales assistant. Draft a concise, warm reply under 3 sentences to offer assistance or answer their question.'
            },
            {
              role: 'user',
              content: `Lead reply context: "${messageContext}". Draft a response.`
            }
          ]
        })
      });

      const aiData = await openRouterResponse.json();
      const generatedReply = aiData.choices?.[0]?.message?.content;

      console.log(`Generated reply for ${leadEmail}:\n`, generatedReply);

      return res.status(200).json({
        status: 'success',
        lead: leadEmail,
        reply: generatedReply
      });
    }

    return res.status(200).json({ status: 'ignored', reason: `Unhandled event: ${payload.event}` });

  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
});

app.get('/health', (req, res) => {
  res.send('Quickly Webhook Worker is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
