# Daily Tasks Carryover

On Obsidian startup, this plugin checks whether the **Daily notes** core plugin is enabled. It uses your local calendar date and the vault's daily note folder and date format.

- Yesterday's open checkboxes appear under **Carried over** in today's note. An existing checkbox with the same text prevents another copy. If today needs a note, Daily Notes creates it with the configured template.
- A checked task in today's note marks matching open checkboxes complete in every earlier daily note. This also works when yesterday's note is missing.

Task matching uses the Markdown on the checkbox line, excluding leading and trailing whitespace. Capitalization and inline formatting must match. Carryovers are written as standalone `- [ ]` items, including when the original checkbox is inside a nested list or callout. Standard `[ ]`, `[x]`, and `[X]` checkboxes are supported.

## Install

Use Obsidian 1.12.7 or later. The two plugin files are ready to install directly.

1. Turn on **Daily notes** under **Settings → Core plugins**.
2. Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/daily-tasks-carryover/`. Use the vault's configured settings folder if it differs from `.obsidian`.
3. Reload Obsidian and enable **Daily Tasks Carryover** under **Settings → Community plugins**. Select **Turn on community plugins** first if prompted.

Run **Daily Tasks Carryover: Sync daily tasks** from the command palette to sync again after checking a task. Obsidian's [manual installation directions](https://github.com/obsidianmd/obsidian-sample-plugin#manually-installing-the-plugin) describe the same plugin folder layout.

## Verify in a sample vault

1. Add `- [ ] Buy groceries` and `- [ ] Send invoice` to yesterday's daily note. Put `- [ ] Send invoice` in an older daily note too.
2. Add `- [x] Send invoice` to today's note and reopen Obsidian.
3. Confirm today's note gains one open **Buy groceries** task and both older invoice checkboxes become `[x]`. Run **Sync daily tasks** again and verify the grocery task appears once.

`main.js` is the plugin entry point and the installable JavaScript. Run `node --check main.js` to check its syntax and `node --test` to run the `test/*.test.cjs` suite with Node.js 20 or later.

## License

[MIT](LICENSE)
