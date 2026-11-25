# japanese-room 作業ルール

- 更新をコミット・プッシュする前に、必ず `git pull --rebase` で最新を取り込むこと。
  古い手元のコピーで上書きして、他で足した内容（例: `library/index.html` の Playground のタイル）が消えるのを防ぐため。
- プッシュ前に `git status` と `git diff --stat` を見て、今回変えていないファイルが変わっていないか確かめること。
- `library/index.html` は Playground の一覧。タイルを足す・消すとき以外は触らない。
