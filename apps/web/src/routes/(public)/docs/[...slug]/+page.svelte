<script lang="ts">
import DocsSeo from "$lib/components/docs/DocsSeo.svelte";
import type { DocsPage } from "$lib/docs";
import DocsArticle from "../DocsArticle.svelte";

const {
	data,
}: {
	data: { doc: DocsPage };
} = $props();
</script>

<DocsSeo doc={data.doc} />
<DocsArticle doc={data.doc} />
