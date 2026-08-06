<script lang="ts">
import InvitePage from "$lib/features/invitations/InvitePage.svelte";

const props = $props<{ params: { token: string } }>();
</script>

<InvitePage token={props.params.token} />
