import type { Model } from '../types'

// Seeded from docs/mockups/app/data.jsx MODELS array.
// Mapping: ctx ('500K' etc.) → context (number); localCap → localCapable.
export const MODELS: Model[] = [
	{
		id: 'opus-4.8',
		provider: 'anthropic',
		route: 'Bedrock',
		tier: 'frontier',
		price: 18.0,
		context: 500000,
		localCapable: false
	},
	{
		id: 'sonnet-4.6',
		provider: 'anthropic',
		route: 'Anthropic',
		tier: 'balanced',
		price: 4.5,
		context: 500000,
		localCapable: false
	},
	{
		id: 'gpt-5.2',
		provider: 'openai',
		route: 'OpenAI',
		tier: 'frontier',
		price: 14.0,
		context: 400000,
		localCapable: false
	},
	{
		id: 'gemini-3-pro',
		provider: 'google',
		route: 'Vercel',
		tier: 'balanced',
		price: 5.0,
		context: 2000000,
		localCapable: false
	},
	{
		id: 'gemini-3-flash',
		provider: 'google',
		route: 'Vercel',
		tier: 'fast',
		price: 0.45,
		context: 1000000,
		localCapable: false
	},
	{
		id: 'llama-4-405b',
		provider: 'meta',
		route: 'OpenRouter',
		tier: 'balanced',
		price: 2.2,
		context: 256000,
		localCapable: false
	},
	{
		id: 'gemma-4-9b',
		provider: 'local',
		route: 'Ollama',
		tier: 'local',
		price: 0.0,
		context: 128000,
		localCapable: true
	},
	{
		id: 'mistral-small-free',
		provider: 'mistral',
		route: 'OpenRouter',
		tier: 'fast',
		price: 0.0,
		context: 128000,
		localCapable: true
	}
]
