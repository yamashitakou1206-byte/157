名鉄運行アプリ・時刻表座標解析修正版

1. app.js -> リポジトリ直下
2. scripts/build_timetable.py -> scripts/ に上書き
3. .github/workflows/update-timetable.yml -> 同じ場所に上書き
4. data/pdfs/ は既存のPDFをそのまま使用
5. GitHub Actions -> Update Meitetsu Timetable -> Run workflow

この版は名鉄PDFの「列車番号・種別・行先が横方向に並び、駅ごとの時刻も同じX座標に並ぶ」構造を利用します。
解析件数が10件未満の場合は処理を失敗させ、0件JSONで既存データを上書きしません。
