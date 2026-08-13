# deepclaw dev

## Install

```bash
$ pnpm install
```

## Start

### Web
```bash
pnpm --filter=@deepclaw/deepclaw web
```

### TUI
```bash
pnpm --filter=@deepclaw/deepclaw tui
```

## Release

`@deepclaw/deepclaw` is the one package of this workspace that gets published. Everything else is
bundled or built into it, so an install needs nothing else of deepclaw from the registry.

```bash
pnpm --filter=@deepclaw/deepclaw build:release
npm publish apps/deepclaw-deepclaw/release
```
