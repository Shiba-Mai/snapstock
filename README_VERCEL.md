# SnapStock Web v23 — ログイン・クラウド保存版

## 追加機能
- メール＋パスワードの新規登録
- ログイン / ログアウト
- ユーザーごとのクラウド保存
- 家計簿 / 在庫 / 買い物リスト / カテゴリ学習をSupabaseへ同期
- 別端末から同じアカウントで同じデータを利用
- 既存localStorageデータがある場合、初回ログイン時にクラウドへ自動移行

## 必須設定

### 1. Supabase
1. Supabaseで新規Projectを作成
2. SQL Editorで `SUPABASE_SETUP.sql` を実行
3. Project Settings / API Keys で以下を確認
   - Project URL
   - Publishable key

### 2. Vercel
Project > Settings > Environment Variables に追加:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Production / Preview / Development すべてに適用して保存し、その後Redeployしてください。

## 認証
Supabase AuthのEmail providerを利用します。
Email confirmationをONにしている場合、新規登録後に確認メールを開く必要があります。

## セキュリティ
`app_state` はRLSを有効化しており、ログイン中のユーザーは自分の `user_id` の行だけ読み書きできます。
Service Role Keyはブラウザへ公開しません。
