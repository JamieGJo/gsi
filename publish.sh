#!/bin/bash
# One-shot: create public GitHub repo from this folder and push to GitHub Pages.
# Requires: gh CLI (https://cli.github.com/), already authenticated.
cd "$(dirname "$0")" || exit 1
gh repo create gsi-datasets --public --source=. --remote=origin --push
echo ""
echo "After the push, enable GitHub Pages in repo settings → Pages → Branch: main, Folder: / (root)"
echo "The site will be available at https://<your-username>.github.io/gsi-datasets/"
