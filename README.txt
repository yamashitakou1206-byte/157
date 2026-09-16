名鉄運行Webアプリ v6.0

■ 今回の仕様
・自動放送なし（音声再生/TTSなし）
・列車種別：ミュースカイ、快速特急、特急、快速急行、急行、準急、普通
・路線・駅検索
・列車番号検索 → 列車詳細画面
・平日／土休日の公式PDF解析データに対応
・路線ごとの表示用乗務区
・現在時刻、次駅、簡易カウントダウン表示
・スマートフォン/iPhone対応
・GitHub Pages対応
・GitHub Actionsで公式PDFデータを更新

■ GitHub Pages
リポジトリ直下に index.html / app.js / style.css / data / tools などを置いてください。
Settings → Pages → Deploy from a branch → main → /(root)

■ 時刻表データ更新
.github/workflows/update-timetable.yml を配置してください。
Actions → 名鉄公式時刻表データ更新 → Run workflow で実行できます。

■ 注意
公式時刻表は名鉄公式サイトの路線別PDFを解析します。公式ページの仕様変更により解析できない場合があります。
運行情報・実際の列車位置・遅延はリアルタイム取得ではありません。
「乗務区」はアプリ内表示用の路線別設定です。公式な個別乗務担当を保証するものではありません。
車両両数は公式PDFから確実に取得できない列車では「—」表示にします。

公式時刻表：https://www.meitetsu.co.jp/train/timetable/
公式運行情報：https://top.meitetsu.co.jp/em/train_emtop.asp
