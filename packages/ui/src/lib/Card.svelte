<script>
	// Zen-Sumi card: raised paper-soft surface + hairline edge + radius.
	// `flush` clips children (for a CardHead + list); `pad` adds standard inner padding.
	let { flush = false, pad = false, class: cls = '', children } = $props()
</script>

<div
	class="rounded-lg border border-paper-edge bg-paper-soft {flush ? 'overflow-hidden' : ''} {pad
		? 'p-5'
		: ''} {cls}"
>
	{@render children?.()}
</div>
