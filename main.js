const { Notice, Plugin, normalizePath } = require("obsidian");

const CHECKBOX_PREFIX = /^(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\][ \t]+/;
const CARRYOVER_HEADING = "Carried over";

function getTasks(markdown, metadata) {
  const tasks = [];

  for (const { task, position } of metadata.listItems ?? []) {
    if (task !== " " && task !== "x" && task !== "X") continue;

    const start = position.start.offset;
    const lineEnd = markdown.indexOf("\n", start);
    const line = markdown.slice(start, lineEnd === -1 ? markdown.length : lineEnd);
    const prefix = CHECKBOX_PREFIX.exec(line);
    if (prefix?.[1] !== task) continue;

    const text = line.slice(prefix[0].length).trim();
    if (text) {
      tasks.push({
        text,
        checked: task !== " ",
        checkboxOffset: start + prefix[0].indexOf("[") + 1,
      });
    }
  }

  return tasks;
}

function insertBlock(markdown, offset, block, newline) {
  const before = markdown.slice(0, offset);
  const after = markdown.slice(offset);
  const blankLine = newline.repeat(2);
  const leading = !before || before.endsWith(blankLine)
    ? ""
    : before.endsWith(newline) ? newline : blankLine;
  const trailing = !after || after.startsWith(newline) ? newline : blankLine;
  return before + leading + block + trailing + after;
}

function isEarlierDailyNote(file, folderPrefix, format, today) {
  if (!file.path.startsWith(folderPrefix)) return false;

  const title = file.path.slice(folderPrefix.length, -".md".length);
  const date = window.moment(title, format, true);
  return date.isValid() && date.isBefore(today, "day") && date.format(format).trim() === title;
}

module.exports = class DailyTasksCarryover extends Plugin {
  onload() {
    this.addCommand({
      id: "sync-daily-tasks",
      name: "Sync daily tasks",
      callback: () => this.runSync(true),
    });
    this.app.workspace.onLayoutReady(() => this.runSync(false));
  }

  onunload() {
    this.unloaded = true;
  }

  async runSync(showNotice) {
    if (this.unloaded || this.syncing) return;
    this.syncing = true;

    try {
      const dailyNotes = this.app.internalPlugins?.getPluginById?.("daily-notes");
      if (!dailyNotes?.enabled) {
        if (showNotice) new Notice("Enable the Daily notes core plugin to sync daily tasks.");
        return;
      }

      const { carried, checked } = await this.syncNotes(dailyNotes.instance);
      if (showNotice && !this.unloaded) {
        new Notice(`Daily tasks synced. ${carried} carried over, ${checked} checked in earlier notes.`);
      }
    } catch (error) {
      console.error("Daily Tasks Carryover", error);
      if (!this.unloaded) new Notice(`Daily task sync stopped. ${error.message}`);
    } finally {
      this.syncing = false;
    }
  }

  async syncNotes(dailyNotes) {
    const { fileManager, vault } = this.app;
    const today = window.moment();
    const yesterday = today.clone().subtract(1, "day");
    const format = dailyNotes.getFormat();
    const folder = dailyNotes.options.folder ? dailyNotes.getFolder() : fileManager.getNewFileParent("");
    if (!folder) throw new Error("The configured Daily Notes folder could not be found.");

    const folderPrefix = folder.path === "/" ? "" : `${folder.path}/`;
    const todayPath = normalizePath(`${folderPrefix}${today.format(format).trim()}.md`);
    const yesterdayPath = normalizePath(`${folderPrefix}${yesterday.format(format).trim()}.md`);
    if (todayPath === yesterdayPath) {
      throw new Error("Choose a Daily Notes date format that gives each day its own file.");
    }

    const openYesterday = new Set();
    const yesterdayFile = vault.getFileByPath(yesterdayPath);
    if (yesterdayFile) {
      const { tasks } = await this.readTaskLayout(await vault.read(yesterdayFile));
      for (const task of tasks) {
        if (!task.checked) openYesterday.add(task.text);
      }
    }

    let todayFile = vault.getFileByPath(todayPath);
    if (!todayFile && openYesterday.size && !this.unloaded) {
      // The core plugin handles templates and folder creation, without opening a pane.
      todayFile = await dailyNotes.getDailyNote(today) ?? vault.getFileByPath(todayPath);
      if (!todayFile) throw new Error("Today's daily note could not be created.");
    }
    if (!todayFile || this.unloaded) return { carried: 0, checked: 0 };

    const todayResult = await this.updateNote(todayFile, async (markdown) => {
      const layout = await this.readTaskLayout(markdown);
      const present = new Set();
      const completed = new Set();
      for (const task of layout.tasks) {
        present.add(task.text);
        if (task.checked) completed.add(task.text);
      }

      const additions = [...openYesterday].filter((text) => !present.has(text));
      if (!additions.length) return { markdown, completed, carried: 0 };

      const updated = await this.insertCarryover(layout, additions);
      return { markdown: updated, completed, carried: additions.length };
    });
    if (!todayResult) return { carried: 0, checked: 0 };

    const { carried, completed } = todayResult;
    let checked = 0;
    if (!completed.size) return { carried, checked };

    for (const file of vault.getMarkdownFiles()) {
      if (this.unloaded) break;
      if (file === todayFile || !isEarlierDailyNote(file, folderPrefix, format, today)) continue;

      const result = await this.updateNote(file, async (markdown) => {
        if (!markdown.includes("[ ]")) return { markdown, checked: 0 };

        const { bom, body, tasks } = await this.readTaskLayout(markdown);
        let updated = body;
        let count = 0;
        for (const task of tasks) {
          if (task.checked || !completed.has(task.text)) continue;

          const offset = task.checkboxOffset;
          updated = updated.slice(0, offset) + "x" + updated.slice(offset + 1);
          count++;
        }
        return { markdown: bom + updated, checked: count };
      });
      checked += result?.checked ?? 0;
    }

    return { carried, checked };
  }

  async readTaskLayout(markdown) {
    // The worker reports offsets after decoding UTF-8, which consumes a leading BOM.
    const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = markdown.slice(bom.length);
    const bytes = new TextEncoder().encode(body).buffer;
    const metadata = await this.app.metadataCache.computeMetadataAsync(bytes);
    if (!metadata) throw new Error("Obsidian could not parse a daily note.");
    return { bom, body, metadata, tasks: getTasks(body, metadata) };
  }

  async insertCarryover({ bom, body, metadata }, additions) {
    const newline = body.includes("\r\n") ? "\r\n" : "\n";
    const list = additions.map((text) => `- [ ] ${text}`).join(newline);
    const section = `## ${CARRYOVER_HEADING}${newline.repeat(2)}${list}`;
    const heading = metadata.headings?.find(({ heading, level, position }) =>
      heading === CARRYOVER_HEADING && level === 2 && position.start.col === 0);
    const preferred = heading
      ? insertBlock(body, heading.position.end.offset, list, newline)
      : insertBlock(body, body.length, section, newline);

    // An unclosed fence or comment can make a section appended at the end invisible.
    const fallbackOffset = metadata.frontmatterPosition?.end.offset ?? 0;
    const fallback = insertBlock(body, fallbackOffset, section, newline);
    for (const candidate of [preferred, fallback]) {
      const { tasks } = await this.readTaskLayout(candidate);
      const visible = new Set(tasks.map(({ text }) => text));
      if (additions.every((text) => visible.has(text))) return bom + candidate;
    }
    throw new Error("Couldn't insert the carried tasks into today's note.");
  }

  async updateNote(file, planChange) {
    const { vault } = this.app;
    const path = file.path;

    for (let attempt = 0; attempt < 3 && !this.unloaded; attempt++) {
      if (file.path !== path) break;

      const original = await vault.read(file);
      const result = await planChange(original);
      if (this.unloaded) return null;
      if (result.markdown === original) return result;

      let applied = false;
      await vault.process(file, (current) => {
        if (this.unloaded || file.path !== path || current !== original) return current;
        applied = true;
        return result.markdown;
      });
      if (applied) return result;
    }

    if (!this.unloaded) throw new Error(`The note changed during sync. Run Sync daily tasks again. (${path})`);
    return null;
  }
};
