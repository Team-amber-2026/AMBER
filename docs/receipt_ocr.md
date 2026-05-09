# 機能仕様：レシート読み取り（OCR）

## 概要
Reactで取得した画像をDjango経由でGoogle Cloud Vision APIへ送信し、解析結果を返す。

## ワークフロー
1. **Frontend**: `input type="file"` またはカメラ起動で画像を取得。
2. **Frontend**: FormData形式でDjango APIへ送信。
3. **Backend**: Google Cloud Vision APIを呼び出し、レスポンスから「店名・日付・金額」を抽出。
4. **Backend**: 解析結果をJSONでフロントへ返却。
5. **Frontend**: 解析結果をフォームに自動入力し、ユーザーに確認を促す。

## エンドポイント案
- `POST /api/receipts/analyze/`: 画像解析リクエスト（DB保存はしない）
