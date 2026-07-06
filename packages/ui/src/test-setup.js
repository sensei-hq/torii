// Mock window.matchMedia for jsdom — not implemented there but required by
// @rokkit/app ColorModeManager.listen() inside ThemeSwitcherToggle.
if (typeof window !== 'undefined' && !window.matchMedia) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false
		})
	})
}
