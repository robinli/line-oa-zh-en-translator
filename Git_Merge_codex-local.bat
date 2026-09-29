# 1. 更新主線
git checkout main
git pull --ff-only origin main

# 2. 更新開發線本身
git checkout codex-local
git pull --ff-only origin codex-local

# 3. 將最新主線合併到開發線
git merge main

# 4. 推送開發線
git push origin codex-local