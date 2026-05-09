# 機能仕様：支出管理（CRUD）

## 概要
DB（PostgreSQL）に保存された支出データの操作を行う。

## 主要機能
- **保存**: 確認済みデータのDB登録。画像はDjangoの `ImageField` で管理。
- **一覧**: Reactの `useEffect` でデータをフェッチし、カード形式またはテーブル形式で表示。
- **編集/削除**: 特定の支出ID（UUID/PK）を指定して更新・消去。

## エンドポイント案
- `GET /api/expenses/`: 支出一覧取得
- `POST /api/expenses/`: 支出データ保存
- `GET /api/expenses/<int:id>/`: 支出詳細取得
- `PUT /api/expenses/<int:id>/`: 支出編集
- `DELETE /api/expenses/<int:id>/`: 支出削除
