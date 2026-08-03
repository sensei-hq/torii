import { gateway, type ChatMessage, type InferResult } from './gateway'
import { cloudInfer } from './cloud'

export type Plane = 'local' | 'cloud'

// The split-plane router: pick the execution plane per Ask turn.
// - local → in-process embedded engine (EmbeddedLlamaAdapter, Tauri IPC), $0, on-device.
// - cloud → proxy to the C1 central gateway (provider keys stay on C1).
// `model` is the member's pinned model (empty/undefined = let the plane auto-route); it maps
// straight onto the existing `opts.model` both legs already accept (cloudInfer / gateway.infer).
// Returns a plane-tagged InferResult so the ask store + Ask UI stay plane-agnostic.
export async function route(
	messages: ChatMessage[],
	plane: Plane,
	model?: string
): Promise<InferResult> {
	const opts = model ? { model } : {}
	if (plane === 'cloud') return cloudInfer(messages, opts)
	const res = await gateway.infer(messages, opts)
	return { ...res, plane: 'local' }
}
