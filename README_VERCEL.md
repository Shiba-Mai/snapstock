# SnapStock Web v20 — Vercel公開版

## 公開手順
1. このフォルダの中身を GitHub の新規リポジトリへアップロード
2. Vercel にログイン
3. Add New → Project
4. GitHub の SnapStock リポジトリを Import
5. Deploy
6. Vercel が `Dockerfile.vercel` を自動検出してコンテナとしてビルド
7. 発行された `https://...vercel.app` URL を共有

## API
OpenAI API / Google Vision API などのAPIキーは不要です。
OCRはPaddleOCRをVercel上のコンテナ内で実行します。

## データ保存
家計簿・在庫・買い物リストはブラウザのlocalStorageに保存します。
利用者・端末ごとに別データになります。

## 注意
- 初回ビルドはPaddleOCR/PaddlePaddleのインストールで時間がかかります。
- 初回OCR時はモデル準備で待ち時間が発生する可能性があります。
- 発表前に公開URLでレシートOCRを事前テストしてください。
- レシート画像はOCRのためSnapStockのVercelサーバーへ送信されます。
