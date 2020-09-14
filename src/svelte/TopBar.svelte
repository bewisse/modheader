<script>
  import TopAppBar, { Row, Section, Title } from "@smui/top-app-bar";
  import Snackbar, { Actions, Label } from "@smui/snackbar";
  import Menu from "@smui/menu";
  import List, { Subheader, Meta, Item, Separator, Text } from "@smui/list";
  import IconButton from "@smui/icon-button";
  import Button from "@smui/button";
  import {
    mdiCheckboxBlankOutline,
    mdiCheckboxMarked,
    mdiRadioboxBlank,
    mdiRadioboxMarked,
    mdiPlus,
    mdiTrashCan,
    mdiClose,
    mdiPlay,
    mdiPause,
    mdiLockOutline,
    mdiLockOpenOutline,
    mdiDotsVertical,
    mdiContentCopy,
    mdiFileExportOutline,
    mdiFileImportOutline,
    mdiShare,
    mdiCloudDownloadOutline,
    mdiCommentCheckOutline,
    mdiCommentRemoveOutline,
    mdiUndo
  } from "@mdi/js";
  import { get } from "svelte/store";
  import { toRgbString, lightOrDark } from "../js/utils";
  import ExportDialog from "./ExportDialog.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import ProfileBadgeDialog from "./ProfileBadgeDialog.svelte";
  import CloudBackupDialog from "./CloudBackupDialog.svelte";
  import MdiIcon from "./MdiIcon.svelte";
  import {
    addHeader,
    addUrlReplacement,
    addFilter,
    selectedProfile,
    changesStack,
    cloneProfile,
    commitChange,
    removeProfile,
    play,
    pause,
    isPaused,
    lockToTab,
    unlockAllTab,
    isLocked,
    undo
  } from "../js/datasource";
  import { showMessage } from "../js/toast";
  import { DISABLED_COLOR } from "../js/constants";

  let colorPicker;
  let pauseSnackbar;
  let tabLockSnackbar;
  let moreMenu;
  let addMenu;
  let exportDialog;
  let importDialog;
  let cloudBackupDialog;
  let profileBadgeDialog;

  function togglePause() {
    if ($isPaused) {
      play();
    } else {
      pause();
    }
  }

  function toggleComment() {
    commitChange({
      hideComment: !$selectedProfile.hideComment
    });
  }

  function toggleAlwaysOn() {
    const alwaysOn = !$selectedProfile.alwaysOn;
    commitChange({ alwaysOn });
    if (alwaysOn) {
      showMessage("This profile will stay active even when it is not selected");
    } else {
      showMessage("This profile will only be active when selected.");
    }
  }

  $: {
    if (pauseSnackbar && tabLockSnackbar) {
      if ($isPaused) {
        tabLockSnackbar.close();
        pauseSnackbar.open();
      } else {
        pauseSnackbar.close();
        if ($isLocked) {
          tabLockSnackbar.open();
        } else {
          tabLockSnackbar.close();
        }
      }
    }
  }
  $: appendMode = ($selectedProfile.appendMode || false).toString();
  $: color =
    lightOrDark($selectedProfile.backgroundColor) === "light"
      ? "black"
      : "white";
</script>

<style scoped>
  .profile-title {
    border: none;
    background: none;
    color: #fff;
    margin: 0 10px;
    font-size: 18px;
    outline: none;
    padding: 0;
  }

  :global(.top-bar) {
    width: 585px;
  }

  :global(.more-menu-icon) {
    margin: 0 5px 0 0;
    padding: 0 2px 0 0;
  }

  .top-bar-profile-badge {
    border: 2px solid white;
    border-radius: 50%;
    font-size: 20px;
    top: 10px;
    position: absolute;
    left: 8px;
  }

  .top-bar-profile-badge-text {
    width: 24px;
    display: flex;
    justify-content: center;
  }
</style>

<ProfileBadgeDialog bind:this={profileBadgeDialog} />

<TopAppBar
  variant
  dense
  class="top-bar"
  style="background-color: {$selectedProfile.backgroundColor};">
  <Row>
    <Section>
      <IconButton
        dense
        class="top-bar-profile-badge-icon"
        on:click={() => {
          profileBadgeDialog.show();
        }}
        title="Change profile badge">
        <span
          class="top-bar-profile-badge"
          style="background: {$selectedProfile.backgroundColor}">
          <span
            class="top-bar-profile-badge-text"
            style="color: {$selectedProfile.textColor}">
            {$selectedProfile.shortTitle}
          </span>
        </span>
      </IconButton>

      <input
        class="mdc-text-field__input profile-title"
        style="color: {$selectedProfile.textColor}"
        value={$selectedProfile.title}
        on:input={event => commitChange({ title: event.target.value })} />
    </Section>
    <Section align="end">
      {#if $changesStack.length > 1}
        <IconButton dense on:click={() => undo()} title="Undo">
          <MdiIcon size="24" icon={mdiUndo} {color} />
        </IconButton>
      {/if}
      <IconButton dense on:click={() => addMenu.setOpen(true)} title="Add">
        <MdiIcon size="24" icon={mdiPlus} {color} />
      </IconButton>
      <Menu bind:this={addMenu} class="add-menu" quickOpen>
        <List>
          <Item
            on:SMUI:action={() => commitChange({
                headers: addHeader($selectedProfile.headers)
              })}>
            Request header
          </Item>
          <Item
            on:SMUI:action={() => commitChange({
                respHeaders: addHeader($selectedProfile.respHeaders)
              })}>
            Response header
          </Item>
          <Item
            on:SMUI:action={async () => commitChange({
                urlReplacements: await addUrlReplacement(
                  $selectedProfile.urlReplacements
                )
              })}>
            URL redirect
          </Item>
          <Item on:SMUI:action={() => addFilter()}>Filter</Item>
        </List>
      </Menu>
      <IconButton
        dense
        on:click={() => togglePause()}
        title={$isPaused ? 'Resume ModHeader' : 'Pause ModHeader'}>
        {#if $isPaused}
          <MdiIcon size="24" icon={mdiPlay} {color} />
        {:else}
          <MdiIcon size="24" icon={mdiPause} {color} />
        {/if}
      </IconButton>
      {#if $isLocked}
        <IconButton dense on:click={() => unlockAllTab()} title="Unlock tab">
          <MdiIcon size="24" icon={mdiLockOutline} {color} />
        </IconButton>
      {:else}
        <IconButton dense on:click={() => lockToTab()} title="Lock to tab">
          <MdiIcon size="24" icon={mdiLockOpenOutline} {color} />
        </IconButton>
      {/if}
      <IconButton
        dense
        on:click={() => exportDialog.show()}
        title="Export / share profile(s)">
        <MdiIcon size="24" icon={mdiShare} {color} />
      </IconButton>
      <IconButton
        dense
        on:click={() => {
          moreMenu.setOpen(true);
        }}
        title="More">
        <MdiIcon size="24" icon={mdiDotsVertical} {color} />
      </IconButton>
      <Menu bind:this={moreMenu} quickOpen>
        <List>
          <Item on:SMUI:action={() => toggleComment()}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={$selectedProfile.hideComment ? mdiCommentCheckOutline : mdiCommentRemoveOutline}
              color="#666" />
            {$selectedProfile.hideComment ? 'Show comment column' : 'Hide comment column'}
          </Item>
          <Item
            on:SMUI:action={() => toggleAlwaysOn()}
            title={$selectedProfile.alwaysOn ? `This profile will stay active even when it is not selected.` : `This profile will only be active when selected.`}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={$selectedProfile.alwaysOn ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
              color="#666" />
            Always stay enabled
          </Item>
          <Separator nav />
          <Item on:SMUI:action={() => removeProfile($selectedProfile)}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={mdiTrashCan}
              color="#666" />
            Delete profile
          </Item>
          <Item on:SMUI:action={() => cloneProfile($selectedProfile)}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={mdiContentCopy}
              color="#666" />
            Clone profile
          </Item>
          <Item on:SMUI:action={() => exportDialog.show()}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={mdiShare}
              color="#666" />
            Export / share profile(s)
          </Item>
          <Item on:SMUI:action={() => importDialog.show()}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={mdiFileImportOutline}
              color="#666" />
            Import profile(s)
          </Item>
          <Item on:SMUI:action={() => cloudBackupDialog.show()}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={mdiCloudDownloadOutline}
              color="#666" />
            Restore from cloud backup
          </Item>
          <Separator nav />
          <Subheader>Header override mode</Subheader>
          <Item on:SMUI:action={() => commitChange({ appendMode: false })}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={appendMode === 'false' ? mdiRadioboxMarked : mdiRadioboxBlank}
              color="#666" />
            <Label>Override existing value</Label>
          </Item>
          <Item on:SMUI:action={() => commitChange({ appendMode: true })}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={appendMode === 'true' ? mdiRadioboxMarked : mdiRadioboxBlank}
              color="#666" />
            <Label>Value concatenation</Label>
          </Item>
          <Item on:SMUI:action={() => commitChange({ appendMode: 'comma' })}>
            <MdiIcon
              class="more-menu-icon"
              size="24"
              icon={appendMode === 'comma' ? mdiRadioboxMarked : mdiRadioboxBlank}
              color="#666" />
            <Label>Comma separated concatenation</Label>
          </Item>
        </List>
      </Menu>
    </Section>
  </Row>
</TopAppBar>

<ExportDialog bind:this={exportDialog} />
<ImportDialog bind:this={importDialog} />
<CloudBackupDialog bind:this={cloudBackupDialog} />

<Snackbar timeoutMs={10000} bind:this={pauseSnackbar}>
  <Label>ModHeader is Paused</Label>
  <Actions>
    <Button on:click={() => play()}>Resume</Button>
  </Actions>
</Snackbar>
<Snackbar timeoutMs={10000} bind:this={tabLockSnackbar}>
  <Label>Tab lock is active</Label>
  <Actions>
    <Button on:click={() => unlockAllTab()}>Unlock</Button>
  </Actions>
</Snackbar>
