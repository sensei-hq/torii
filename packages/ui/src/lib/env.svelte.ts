// Capability/env state shared by the shell. Mirrors the mockups' ToriiEnv.
type Mode = 'desktop' | 'offline' | 'web'
const ORDER: Mode[] = ['desktop', 'offline', 'web']

class Env {
	mode = $state<Mode>('desktop')
	get desktop() {
		return this.mode === 'desktop' || this.mode === 'offline'
	}
	get web() {
		return this.mode === 'web'
	}
	get offline() {
		return this.mode === 'offline'
	}
	cycle() {
		this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length]
	}
	set(mode: Mode) {
		this.mode = mode
	}
}
export const env = new Env()
