export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function navigateTo(tauriPage: any, route: string): Promise<void> {
	await tauriPage.evaluate(`
    (async function () {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const nav = await import('/node_modules/@sveltejs/kit/src/runtime/app/navigation.js')
        await nav.goto(${JSON.stringify(route)})
      } catch {
        const a = document.createElement('a')
        a.href = ${JSON.stringify(route)}
        document.body.appendChild(a)
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        document.body.removeChild(a)
      }
    })()
  `)
	await sleep(800)
}
