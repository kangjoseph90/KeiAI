<script lang="ts">
    import LibraryView from './LibraryView.svelte';
    import MultiRoomsView from './MultiRoomsView.svelte';
    import type { RouteState } from '$lib/router';

    interface Props {
        space?: 'library' | 'multiRooms';
        onNavigate: (route: RouteState) => void;
    }

    let { space = 'library', onNavigate }: Props = $props();
</script>

{#if space === 'multiRooms'}
    <MultiRoomsView {onNavigate} />
{:else}
    <LibraryView {onNavigate} />
{/if}
