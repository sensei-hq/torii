<script>
  import { setContext, onMount } from 'svelte'
  import { page } from '$app/state'
  import { invalidateAll } from '$app/navigation'

  let { children } = $props()

  const kavach = $state({})
  setContext('kavach', kavach)

  onMount(async () => {
    const { createKavach } = await import('kavach')
    const { adapter, logger } = await import('$kavach/auth')
    Object.assign(kavach, createKavach(adapter, { logger, invalidateAll }))
    kavach.onAuthChange(page.url)
  })
</script>

{@render children()}
