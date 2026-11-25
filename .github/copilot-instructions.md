# AI Token-Saving Guidelines for GitHub Copilot
This repository uses **ReduceToken** to optimize context and save tokens.
- **NEVER** scan the entire directory tree or read dozens of files indiscriminately.
- **ALWAYS** check `.codegraph/architecture_map.md` first to understand repository structure and module responsibilities.
- Use `reducetoken query <symbol_or_keyword>` to locate exact files, definitions, and dependencies.
- Only inspect the specific target file and its direct 1-hop dependencies.
