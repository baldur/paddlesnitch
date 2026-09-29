#!/usr/bin/env bash
# Print the permalink of every blog post that should be live by <date>: dated
# on or before it and not a draft. The daily publish-scheduled-posts workflow
# checks each one on the live site and redeploys if any is missing (a post
# dated in the future is left out of the build until then).
# Usage: blog-due.sh <content/blog dir> <YYYY-MM-DD>
set -euo pipefail
dir="$1" today="$2"
for f in "$dir"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md; do
  [ -e "$f" ] || continue
  name=$(basename "$f" .md)
  date=${name:0:10} slug=${name:11}
  [[ "$date" > "$today" ]] && continue
  # Front matter only: the lines between the first two '---'.
  if awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1' "$f" | grep -qE '^draft:[[:space:]]*true[[:space:]]*$'; then continue; fi
  echo "/blog/${date:0:4}/${date:5:2}/${date:8:2}/$slug"
done
