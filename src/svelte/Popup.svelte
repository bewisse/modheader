<script>
  import { AppContent } from "@smui/drawer";
  import Snackbar, { Actions, Label as SnackbarLabel } from "@smui/snackbar";
  import IconButton from "@smui/icon-button";
  import Button from "@smui/button";
  import { mdiClose } from "@mdi/js";
  import { onDestroy } from "svelte";
  import lodashCloneDeep from "lodash/cloneDeep";
  import TopBar from "./TopBar.svelte";
  import Drawer from "./Drawer.svelte";
  import Filters from "./Filters.svelte";
  import Headers from "./Headers.svelte";
  import {
    selectedProfile,
    isPaused,
    addHeader,
    removeHeader,
    addUrlReplacement,
    removeUrlReplacement,
    commitChange,
    undo,
    save,
    init
  } from "../js/datasource";
  import MdiIcon from "./MdiIcon.svelte";
  import { toastMessage, undoable } from "../js/toast";
  import { getSync, setSync } from "../js/storage";
  import { getActiveTab } from "../js/tabs";
  import {
    KNOWN_REQUEST_HEADERS,
    KNOWN_RESPONSE_HEADERS
  } from "../js/constants";

  let snackbar;
  let snackbarMessage;

  window.addEventListener("unload", save);

  const unsubscribeToastMessage = toastMessage.subscribe(message => {
    if (snackbar) {
      snackbarMessage = message;
      if (message.length > 0) {
        snackbar.open();
      } else {
        snackbar.close();
      }
    }
  });

  onDestroy(unsubscribeToastMessage);
</script>

<style>
  :global(html, body) {
    font-family: Roboto, Helvetica Neue, sans-serif;
    height: 460px;
    /** Fix FF popup disappearance on long window. */
    width: 630px !important;
    position: relative !important;
    overflow-x: hidden;
    margin: 0;
  }

  :global(button::-moz-focus-inner) {
    border: 0;
  }

  :global(.mdc-dialog__content) {
    overflow-x: hidden !important;
  }

  :global(.extra-gap) {
    margin: 2px;
  }

  :global(.small-icon-button) {
    width: 28px;
    height: 28px;
    padding: 0;
    margin: 0;
  }

  :global(.medium-icon-button) {
    width: 36px;
    height: 36px;
    padding: 0;
    margin: 0;
  }

  :global(.small-text-button) {
    height: 28px;
    margin: 0 2px;
  }

  :global(.hidden) {
    display: none !important;
  }

  :global(.app-content) {
    margin-left: 0 !important;
    width: 580px;
    position: absolute;
    left: 50px;
  }

  :global(.disabled) {
    opacity: 0.5;
    pointer-events: none;
  }

  :global(.large-textarea) {
    width: 100%;
    height: 50px;
  }

  :global(.ml-small) {
    margin-left: 5px;
  }

  :global(.dialog-close-button) {
    float: right;
    top: 4px;
  }

  :global(.data-table) {
    margin-bottom: 10px;
    width: calc(100% - 10px);
  }

  :global(.data-table-title) {
    margin: 6px 0;
    font-size: 16px;
  }

  :global(.data-table-row-unchecked) {
    background: #eee;
  }

  :global(.data-table-row) {
    display: flex;
    justify-content: start;
    height: 32px;
  }

  :global(.data-table-title-row) {
    margin-top: 5px;
    height: 40px;
  }

  :global(.data-table-cell) {
    padding: 0 2px;
  }

  :global(.data-table .mdc-checkbox) {
    padding: 2px;
    margin-top: 4px;
  }

  :global(.data-table .mdc-checkbox .mdc-checkbox__background) {
    top: 2px;
    left: 8px;
  }

  :global(.flex-grow) {
    flex-grow: 1;
  }

  :global(.flex-fixed-icon) {
    flex-basis: 30px;
    flex-shrink: 0;
    --mdc-ripple-top: 2px !important;
  }

  .top-app-bar-container {
    height: 48px;
  }
</style>

{#await init() then initResult}
  <Drawer />

  <AppContent class="app-content">
    <div class="top-app-bar-container">
      <TopBar />
    </div>
    <div class={$isPaused ? 'disabled' : ''}>
      {#if $selectedProfile.headers.length > 0}
        <Headers
          headers={lodashCloneDeep($selectedProfile.headers)}
          class="extra-gap"
          title="Request headers"
          autocompleteListId="request-autocomplete"
          autocompleteNames={KNOWN_REQUEST_HEADERS}
          on:add={() => {
            commitChange({ headers: addHeader($selectedProfile.headers) });
          }}
          on:remove={event => {
            commitChange({
              headers: removeHeader($selectedProfile.headers, event.detail)
            });
          }}
          on:refresh={event => {
            commitChange({ headers: event.detail });
          }} />
      {/if}
      {#if $selectedProfile.respHeaders.length > 0}
        <Headers
          headers={lodashCloneDeep($selectedProfile.respHeaders)}
          class="extra-gap"
          title="Response headers"
          autocompleteListId="response-autocomplete"
          autocompleteNames={KNOWN_RESPONSE_HEADERS}
          profile={selectedProfile}
          on:add={() => {
            commitChange({
              respHeaders: addHeader($selectedProfile.respHeaders)
            });
          }}
          on:remove={event => {
            commitChange({
              respHeaders: removeHeader(
                $selectedProfile.respHeaders,
                event.detail
              )
            });
          }}
          on:refresh={event => {
            commitChange({ respHeaders: event.detail });
          }} />
      {/if}
      {#if $selectedProfile.urlReplacements.length > 0}
        <Headers
          headers={lodashCloneDeep($selectedProfile.urlReplacements)}
          class="extra-gap"
          title="Redirect URLs"
          nameLabel="Original URL"
          valueLabel="Redirect URL"
          profile={$selectedProfile}
          on:add={async () => {
            commitChange({
              urlReplacements: await addUrlReplacement(
                $selectedProfile.urlReplacements
              )
            });
          }}
          on:remove={event => {
            commitChange({
              urlReplacements: removeUrlReplacement(
                $selectedProfile.urlReplacements,
                event.detail
              )
            });
          }}
          on:refresh={event => {
            commitChange({ urlReplacements: event.detail });
          }} />
      {/if}
      {#if $selectedProfile.filters.length > 0}
        <Filters
          filters={lodashCloneDeep($selectedProfile.filters)}
          class="extra-gap" />
      {/if}
    </div>
  </AppContent>

  <Snackbar timeoutMs={4000} bind:this={snackbar} labelText={snackbarMessage}>
    <SnackbarLabel />
    <Actions>
      {#if $undoable}
        <Button on:click={() => undo()}>Undo</Button>
      {/if}
      <IconButton dense on:click={() => snackbar.close()} title="Dismiss">
        <MdiIcon size="24" icon={mdiClose} color="white" />
      </IconButton>
    </Actions>
  </Snackbar>
{/await}
