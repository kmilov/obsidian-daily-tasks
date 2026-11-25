# Repository Guidelines

## Project Structure

The `obsidian-daily-tasks` workspace starts with this guide. As source files, tests, and assets are added, list their paths and the main entry point here. Use small, synthetic notes for examples and test fixtures.

## Build and Development

Build, lint, and local run commands are pending the first implementation. When adding tooling, document the required versions, setup steps, and runnable commands from the repository root. Include a command's expected result when it helps contributors verify setup.

## Coding Style and Naming

Follow the indentation, naming, and formatting used by adjacent files. Give note templates and fixtures descriptive names that reflect their purpose, such as `daily-note-with-completed-tasks.md`. In Markdown examples, use `- [ ]` for an open task and `- [x]` for a completed task.

## Testing

For changes to daily notes or task behavior, check the workflow in a sample Obsidian vault. Try a fresh daily note and an existing note with open and completed tasks. Verify that tasks render correctly and that existing task text and checkbox states are preserved where expected. Document the test command, test file naming pattern, and any coverage target here when automated tests are introduced.

## Commits and Pull Requests

Write a short, imperative commit subject, such as `Add a daily note template`. In each pull request, summarize the change and describe how you verified it. Link any relevant issue and include a screenshot when it helps explain a visible change.
