import { gateway, type ChatMessage, type InferResult } from './gateway'
import { cloudInfer } from './cloud'

export type Plane = 'local' | 'cloud'

// The split-plane router: pick the execution plane per Ask turn.
// - local → in-process embedded engine (EmbeddedLlamaAdapter, Tauri IPC), $0, on-device.
// - cloud → proxy to the C1 central gateway (provider keys stay on C1).
// Returns a plane-tagged InferResult so the ask store + Ask UI stay plane-agnostic.
export async function route(messages: ChatMessage[], plane: Plane): Promise<InferResult> {
	if (plane === 'cloud') return cloudInfer(messages)
	const res = await gateway.infer(messages)
	return { ...res, plane: 'local' }
}
