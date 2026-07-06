<script>
  let { app = 'admin', title = '', children } = $props()
  const NAV = {
    admin: ['Overview', 'Requests', 'Organization', 'Models', 'Routing', 'Connections', 'Governance', 'Billing', 'Settings'],
    console: ['Workspace', 'Ask', 'Library', 'Playground', 'Workflows', 'Activity', 'Settings']
  }
  const items = $derived(NAV[app] ?? [])
</script>

<div data-app-shell class="grid h-full grid-cols-[13rem_1fr]">
  <nav aria-label="Primary" class="flex flex-col gap-1 border-r border-surface-z3 bg-surface-z1 p-3">
    <div class="mb-3 text-sm font-semibold text-primary-500">Strategos</div>
    {#each items as item (item)}
      <a href={`#${item.toLowerCase()}`} class="rounded px-2 py-1 text-sm text-surface-z6 hover:bg-surface-z2">{item}</a>
    {/each}
  </nav>
  <section class="flex h-full flex-col">
    <header class="flex items-center border-b border-surface-z3 px-4 py-3">
      <h1 class="text-base font-medium text-surface-z8">{title}</h1>
    </header>
    <div class="flex-1 overflow-auto">{@render children?.()}</div>
  </section>
</div>
