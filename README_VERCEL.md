# SnapStock Web v22 — HEIC/HEIF対応版

## v22の修正
- iPhoneでよく使われるHEIC/HEIF画像に対応
- HEIC/HEIFはブラウザ内でJPEGへ自動変換
- JPG/JPEG/PNGは従来どおり利用可能
- 変換後にJPEGとしてOCRへ送信
- 画像形式の違いで「ブラウザで開けません」が出にくい構成に変更

## GitHubへの反映
既存のsnapstockリポジトリでv22のファイルをアップロードし、Commitしてください。
Vercelが自動で再デプロイします。

## 注意
HEIC変換にはブラウザ側でheic2anyを利用します。
