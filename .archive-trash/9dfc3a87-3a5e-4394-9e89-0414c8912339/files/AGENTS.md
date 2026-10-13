
## Project Brain

This project uses `project-brain` as its persistent project memory system.

Before starting any substantial work, read these files in order:

1. `brain/MAP.md`
2. `brain/STATUS.md`
3. `brain/HANDOFF.md` if it exists and is non-empty

Use the `brain/` folder to understand project context, current progress, prior decisions, and handoff notes.

### Brain file roles

- `brain/PROJECT.md` explains what this project is and what it is not.
- `brain/MAP.md` is the index of important project documents and topic files.
- `brain/STATUS.md` tracks current progress, active work, blockers, and next steps.
- `brain/DECISIONS.md` records important decisions, including rejected alternatives.
- `brain/HANDOFF.md` is used when switching sessions or when context is nearly full.
- `brain/topics/` contains longer topic-specific notes.

### Startup workflow

When asked to continue the project:

1. Read `brain/MAP.md`.
2. Read `brain/STATUS.md`.
3. Read `brain/HANDOFF.md` if present.
4. Summarize:
   - what the project is
   - current status
   - recent progress
   - blockers
   - recommended next step


<!-- antd-cli setup start -->
## Ant Design CLI Skill

Use the shared Ant Design skill at `.agents/skills/antd/SKILL.md` before working on Ant Design code in this repository.

The skill teaches agents when and how to call `@ant-design/cli` commands such as `antd info`, `antd doc`, `antd demo`, `antd token`, `antd semantic`, and `antd changelog`.

<!-- antd-cli setup end -->

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
