const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const QUICKLY_API_KEY = process.env.QUICKLY_API_KEY;
const QUICKLY_BASE_URL = process.env.QUICKLY_BASE_URL || 'https://quickly-production-b4f1.up.railway.app';
const MODEL = process.env.DEFAULT_MODEL || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Quickly Webhook:', JSON.stringify(payload, null, 2));

    // 1. Handle test webhooks from Quickly
    if (payload.event === 'test') {
      console.log('Test event received successfully.');
      return res.status(200).json({ status: 'ok', message: 'Test event received' });
    }

    // 2. Handle incoming lead replies
    if (payload.event === 'lead.replied') {
      const data = payload.data || {};
      const leadEmail = data.lead_email;
      const messageId = data.message_id;
      const threadId = data.thread_id;
      const inboxId = data.inbox_id;

      console.log(`Processing reply from ${leadEmail} (Thread: ${threadId})`);

      let leadMessageText = data.message || data.text;

      // Fetch full message body from Quickly API if not provided in payload
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

      const messageContext = leadMessageText || `The lead ${data.lead_name || leadEmail} replied to our campaign.`;

      // 3. Request custom response from OpenRouter
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
              content: 'You are an AI sales assistant replying to a prospective lead. Draft a concise, warm reply under 3 sentences to offer assistance or answer their questions.'
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

      console.log(`Generated reply for ${leadEmail}:\n${generatedReply}`);

      // 4. Dispatch generated response back to Quickly to send email out
      if (generatedReply && threadId && QUICKLY_API_KEY) {
        try {
          const sendResponse = await fetch(`${QUICKLY_BASE_URL}/api/threads/${threadId}/reply`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${QUICKLY_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: generatedReply,
              inbox_id: inboxId
            })
          });

          if (sendResponse.ok) {
            console.log(`Successfully dispatched reply email to ${leadEmail}`);
          } else {
            console.error('Failed to dispatch reply via Quickly API:', await sendResponse.text());
          }
        } catch (sendErr) {
          console.error('Error sending reply via Quickly API:', sendErr.message);
        }
      }

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
