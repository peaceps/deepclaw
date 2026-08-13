# deepclaw dev

## Install

```bash
$ pnpm install
```

## Start

### Web
```bash
pnpm --filter=@sacephor/deepclaw web
```

### TUI
```bash
pnpm --filter=@sacephor/deepclaw tui
```

## Release

`@sacephor/deepclaw` is the one package of this workspace that gets published. Everything else is
bundled or built into it, so an install needs nothing else of deepclaw from the registry.

```bash
pnpm --filter=@sacephor/deepclaw build:release
npm publish apps/sacephor-deepclaw/release
```
