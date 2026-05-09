# 技術構成・インフラ仕様

## 構成
- **Frontend**: React (Vite) -> Render (Static Site)
- **Backend**: Python (Django) -> Render (Web Service)
- **Database**: PostgreSQL (Render Managed DB)
- **Storage**: Cloudinary または Render上のディスク（レシート画像保存用）

## 環境変数 (.env) 管理
- `DATABASE_URL`: DB接続情報
- `GOOGLE_APPLICATION_CREDENTIALS`: OCR認証情報
- `CORS_ALLOWED_ORIGINS`: フロントエンドのURLを許可
