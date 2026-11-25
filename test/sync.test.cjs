const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { posix } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(require.resolve("../main.js"), "utf8");
const today = "2026-11-25.md";
const yesterday = "2026-11-24.md";
const earlier = "2026-11-21.md";
const originalDate = new Date("2026-11-25T01:00:00Z");

function fakeMoment(value) {
  const date = value === undefined ? new Date(originalDate) : new Date(value);
  return {
    clone: () => fakeMoment(date),
    subtract(days) {
      date.setUTCDate(date.getUTCDate() - days);
      return this;
    },
    format(format) {
      const [year, month, day] = date.toISOString().slice(0, 10).split("-");
      const monthName = date.toLocaleString("en", { month: "long", timeZone: "UTC" });
      return format.replace(/YYYY|MMMM|MM|DD/g, (part) => ({
        YYYY: year, MMMM: monthName, MM: month, DD: day,
      })[part]);
    },
    isValid: () => !Number.isNaN(date.valueOf()),
    isBefore: (other) => date.toISOString().slice(0, 10) < other.format("YYYY-MM-DD"),
  };
}

function fakeMetadata(bytes) {
  const listItems = [];
  let offset = 0;
  for (const line of new TextDecoder().decode(bytes).split("\n")) {
    const checkbox = /^- \[([ xX])\] /.exec(line);
    if (checkbox) listItems.push({ task: checkbox[1], position: { start: { offset } } });
    offset += line.length + 1;
  }
  return { listItems };
}

function setup(contents, { enabled = true, folder = "", format = "YYYY-MM-DD", beforeWrite } = {}) {
  const files = new Map(Object.entries(contents).map(([path]) => [path, { path }]));
  const notes = new Map(Object.entries(contents));
  const writes = [];
  const notices = [];
  let start;
  let command;
  const module = { exports: null };
  const normalizePath = (path) => posix.normalize(path).replace(/^\//, "");
  runInNewContext(source, {
    module,
    console,
    TextEncoder,
    window: {
      moment: (input) => fakeMoment(input === undefined ? undefined : input.split("/").at(-1)),
    },
    require(name) {
      assert.equal(name, "obsidian");
      return {
        normalizePath,
        Plugin: class {
          addCommand(spec) { command = spec.callback; }
        },
        Notice: class {
          constructor(message) { notices.push(message); }
        },
      };
    },
  });

  const vault = {
    getFileByPath: (path) => files.get(path),
    getMarkdownFiles: () => [...files.values()],
    async read({ path }) { return notes.get(path); },
    async process({ path }, update) {
      beforeWrite?.(path, notes);
      const current = notes.get(path);
      const changed = update(current);
      if (changed !== current) writes.push(path);
      notes.set(path, changed);
    },
  };
  const plugin = new module.exports();
  plugin.app = {
    vault,
    workspace: { onLayoutReady(callback) { start = callback; } },
    metadataCache: { computeMetadataAsync: fakeMetadata },
    fileManager: { getNewFileParent: () => ({ path: "/" }) },
    internalPlugins: {
      getPluginById(id) {
        assert.equal(id, "daily-notes");
        return {
          enabled,
          instance: {
            options: { folder },
            getFolder: () => ({ path: folder }),
            getFormat: () => format,
            async getDailyNote(date) {
              const path = normalizePath(`${folder}/${date.format(format)}.md`);
              const file = { path };
              files.set(path, file);
              notes.set(path, "# From the daily template\n");
              return file;
            },
          },
        };
      },
    },
  };
  plugin.onload();
  return { notes, start, command, writes, notices };
}

test("startup skips the vault when Daily Notes is disabled", async () => {
  const { notes, start, command, writes, notices } = setup({
    [yesterday]: "- [ ] Send invoice\n",
    [today]: "- [x] Send invoice\n",
  }, { enabled: false });

  await start();
  assert.deepEqual(writes, []);
  assert.equal(notes.get(yesterday), "- [ ] Send invoice\n");
  await command();
  assert.match(notices[0], /Enable the Daily notes/);
});

test("startup carries only yesterday's open tasks and checks exact matches in earlier daily notes", async () => {
  const { notes, start, command, writes } = setup({
    [today]: "# Today\n\n- [X] Send invoice\n- [ ] Already here\n",
    [yesterday]: "- [ ] Buy groceries\n- [x] Finished yesterday\n- [ ] Send invoice\n- [ ] Already here\n",
    [earlier]: "- [ ] Send invoice\n- [ ] Send invoice reminder\n- [ ] Old task\n",
    "2026-11-26.md": "- [ ] Send invoice\n",
    "archive/2026-11-21.md": "- [ ] Send invoice\n",
  });

  await start();
  const result = "# Today\n\n- [X] Send invoice\n- [ ] Already here\n\n## Carried over\n\n- [ ] Buy groceries\n";
  assert.equal(notes.get(today), result);
  assert.equal(notes.get(yesterday), "- [ ] Buy groceries\n- [x] Finished yesterday\n- [x] Send invoice\n- [ ] Already here\n");
  assert.equal(notes.get(earlier), "- [x] Send invoice\n- [ ] Send invoice reminder\n- [ ] Old task\n");
  assert.equal(notes.get("2026-11-26.md"), "- [ ] Send invoice\n");
  assert.equal(notes.get("archive/2026-11-21.md"), "- [ ] Send invoice\n");

  await command();
  assert.equal(notes.get(today), result);
  assert.deepEqual(writes, [today, yesterday, earlier]);
});

test("when today is missing, creates it through Daily Notes using the configured folder and template", async () => {
  const folder = "Journal";
  const { notes, start } = setup({
    [`${folder}/2026/November/${yesterday}`]: "- [ ] Buy groceries\n",
  }, { folder, format: "YYYY/MMMM/YYYY-MM-DD" });

  await start();
  assert.equal(notes.get(`${folder}/2026/November/${today}`),
    "# From the daily template\n\n## Carried over\n\n- [ ] Buy groceries\n");
});

test("checks older tasks when yesterday's note is missing", async () => {
  const { notes, start, writes } = setup({
    [today]: "- [x] Send invoice\n",
    [earlier]: "- [ ] Send invoice\n- [ ] Old task\n",
  });

  await start();
  assert.deepEqual(writes, [earlier]);
  assert.equal(notes.get(earlier), "- [x] Send invoice\n- [ ] Old task\n");
  assert.equal(notes.has(yesterday), false);
});

test("replans the carryover if today's note changes before the write", async () => {
  let changed = false;
  const { notes, start, writes } = setup({
    [today]: "# Today\n",
    [yesterday]: "- [ ] Buy groceries\n- [ ] Read chapter\n",
  }, {
    beforeWrite(path, currentNotes) {
      if (!changed && path === today) {
        currentNotes.set(path, "# Today\n\n- [ ] Buy groceries\n\nNew paragraph.\n");
        changed = true;
      }
    },
  });

  await start();
  assert.equal(notes.get(today), "# Today\n\n- [ ] Buy groceries\n\nNew paragraph.\n\n## Carried over\n\n- [ ] Read chapter\n");
  assert.deepEqual(writes, [today]);
});
