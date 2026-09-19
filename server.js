const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';

// Webhook receiver endpoint for Quickly
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Quickly Webhook:', JSON.stringify(payload, null, 2));

    // Extract message content and classification
    const leadEmail = payload.email || payload.lead_email;
    const leadMessage = payload.message || payload.text || payload.content;
    const classification = payload.classification || payload.category;

    // Only auto-reply if lead is classified as 'interested'
    if (classification && classification !== 'interested') {
      console.log(`Skipping auto-reply for non-interested lead: ${classification}`);
      return res.status(200).json({ status: 'ignored', reason: `Classification: ${classification}` });
    }

    if (!leadMessage) {
      return res.status(400).json({ error: 'No lead message found in payload' });
    }

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
            content: 'You are an executive assistant replying to prospective sales leads. Keep replies warm, concise (under 3 sentences), and offer a quick call to answer questions.'
          },
          {
            role: 'user',
            content: `A lead replied to our email: "${leadMessage}". Draft a short, helpful reply.`
          }
        ]
      })
    });

    const aiData = await openRouterResponse.json();
    const generatedReply = aiData.choices?.[0]?.message?.content;

    console.log(`Generated reply for ${leadEmail}:`, generatedReply);

    // Return generated response to Quickly or downstream webhook
    return res.status(200).json({
      status: 'success',
      recipient: leadEmail,
      reply_text: generatedReply
    });

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