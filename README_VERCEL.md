# SnapStock Web v21 — Vercel公開版

## v21の修正
- Vercel上で画像選択直後に失敗する問題を修正
- createImageBitmap()を優先して画像を読み込み
- 非対応環境ではImage()にフォールバック
- 画像をブラウザ内でJPEGへ変換してからOCR送信
- 最大辺2200pxへ縮小し、ブラウザのメモリ負荷を軽減
- 20MBを超える画像は明確にエラー表示
- 読み込み成功時にファイルサイズと画像形式を表示
- OCR失敗時にHTTPエラーも表示

## GitHubへの反映
既存のsnapstockリポジトリでv21のファイルに置き換えてCommitしてください。
VercelはGitHub更新を検知して自動再デプロイします。
