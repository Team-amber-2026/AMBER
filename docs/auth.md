# 機能仕様：ユーザー認証 (Session Auth)

## 概要
Django標準の認証システムを利用し、Reactフロントエンドとセッションベースで連携する。

## 技術詳細
- **Backend**: Django REST Framework (DRF) の `SessionAuthentication`
- **Frontend**: Axiosによる認証リクエスト
- **セキュリティ**: CSRFトークンのやり取りを必須とする

## エンドポイント案
- `POST /api/auth/register/`: 新規登録
- `POST /api/auth/login/`: ログイン
- `POST /api/auth/logout/`: ログアウト
- `GET /api/auth/user/`: ログイン中のユーザー情報取得
