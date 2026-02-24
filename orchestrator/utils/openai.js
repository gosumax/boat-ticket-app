function extractTextFromResponse(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  if (Array.isArray(data?.output)) {
    const chunks = [];
    for (const item of data.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const contentPart of item.content) {
        if (typeof contentPart?.text === 'string') {
          chunks.push(contentPart.text);
        }
      }
    }
    return chunks.join('\n').trim();
  }

  return '';
}

export async function callModel(model, prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  if (!model) {
    throw new Error('Model is required');
  }
  if (!prompt) {
    throw new Error('Prompt is required');
  }

  const endpoint = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/responses';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    text: extractTextFromResponse(data),
    raw: data,
  };
}
