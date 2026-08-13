#!/usr/bin/env bash
set -e

# --publishOnly reuses the builds that are already there and only stages them again, which keeps
# what gets published in step with the sources without waiting for a build of everything
if [ "$1" = "--publishOnly" ]; then
    pnpm --filter=@sacephor/deepclaw build:release --staged
else
    pnpm --filter=@sacephor/deepclaw build:release
fi

npm publish --access public apps/sacephor-deepclaw/release
