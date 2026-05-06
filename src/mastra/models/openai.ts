import { createAzure } from '@ai-sdk/azure';

export const azureProvider = createAzure({
  resourceName: process.env.AZURE_RESOURCE_NAME,
  apiKey: process.env.AZURE_API_KEY,
  apiVersion: process.env.AZURE_API_VERSION ?? 'preview',
});

export const createAzureModel = (
  deployment = process.env.AZURE_CHAT_DEPLOYMENT ?? 'gpt-5.4-1',
) => azureProvider(deployment);

export const defaultAzureModel = createAzureModel();
