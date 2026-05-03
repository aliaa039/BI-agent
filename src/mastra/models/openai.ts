import { createOpenAI } from '@ai-sdk/openai';


export const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const createOpenAIModel = (model = process.env.OPENAI_MODEL ?? 'gpt-5.4-1') => {
  return openaiProvider(model);
};

export const defaultOpenAIModel = createOpenAIModel();