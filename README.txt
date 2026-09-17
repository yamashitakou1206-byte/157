MEITETSU Operation Web v6.2 - PWA / Driver Display対応版

■ 今回の対応
- PWA (manifest.webmanifest) 対応
- iPhone / iPadでホーム画面に追加して起動した場合、Safariのアドレスバー等を表示しないスタンドアロン表示
- Windows等でPWAとしてインストールした場合もアプリ風表示
- 列車詳細画面を開く操作からFullscreen APIが利用できるブラウザでは全画面化を試行
- 横向き画面では、左に運転表示・時刻表、右に時計・記事を配置するドライバー表示風レイアウト
- safe-area (iPhone/iPadのノッチ等) 対応
- Service Workerで基本ファイルをキャッシュし、時刻表JSONはネットワーク優先
- 前回のPDF座標解析v8（文字化け・重複数字・列ずれ対策）を統合

■ GitHubへ入れるファイル
このZIP内の以下をリポジトリへコピーしてください。
  index.html
  style.css
  app.js
  manifest.webmanifest
  sw.js
  icon.svg
  icon-180.png
  scripts/build_timetable.py
  .github/workflows/update-timetable.yml

既存の data/pdfs/ はそのまま残してください。

■ GitHub Actions
Actions → Update Meitetsu Timetable → Run workflow
を実行すると、data/pdfs/ 内のPDFを解析して data/timetables.json を更新します。

■ iPhone / iPad
SafariでGitHub Pagesを開く → 共有 → ホーム画面に追加 → ホーム画面のアイコンから起動。
通常のSafariタブからSafariのUIそのものをJavaScriptで強制的に消すことはiOSの制限があります。PWA起動が推奨です。

■ 注意
この版の「現在位置」「運行状態」はシミュレーションです。自動音声放送はありません。
