# ためるん

## プロダクト概要

**ためるん** は、レシートを撮影またはアップロードするだけで、支出を記録し、今月の支出合計を確認できる家計簿Webアプリです。

家計簿をつけたいけれど、毎回手入力するのが面倒な人や、入力を忘れてしまう人を対象にしています。  
レシート画像をOCRで読み取り、日付・店名・合計金額・カテゴリーを登録することで、日々の支出管理を簡単にします。

## チーム情報

| 項目 | 内容 |
|---|---|
| チーム名 | Amber |
| プロダクト名 | ためるん |
| メンバー | 香川 歩美 / 林 乃愛 / 眞下 隼和 / 吉見 仁那 / 重森 星児 |
| 制作テーマ | レシート読み込み機能付き家計簿アプリ |

## 解決したい課題

- 家計簿をつけたいと思っていても、レシートの内容を毎回手入力するのが面倒で、支出の記録が続かない。

## 想定ユーザー

- 家計管理をしたい人
- レシートをためがちな人
- 手入力の家計簿が続かない人
- 毎月の支出を簡単に把握したい人

## MVP

MVPでは、以下の流れが動く状態を完成とみなします。

```text
ログイン
 ↓
レシート画像を撮影またはアップロード
 ↓
OCRで文字を読み取る
 ↓
日付・店名・合計金額・カテゴリーを確認する
 ↓
必要があれば修正する
 ↓
保存する
 ↓
今月の支出合計に反映される
```

## MVPで作る機能

| 機能名 | 内容 | 優先度 |
|---|---|---|
| ユーザー登録機能 | 新規ユーザーを登録する | 高 |
| ログイン機能 | 登録済みユーザーがログインする | 高 |
| ログアウト機能 | ログイン中のユーザーがログアウトする | 高 |
| レシート画像アップロード機能 | レシート画像を選択・アップロードする | 高 |
| OCR読み取り機能 | 画像から文字を読み取る | 高 |
| OCR結果確認機能 | 読み取った内容を確認する | 高 |
| OCR結果修正機能 | 日付・店名・金額・カテゴリーを手動修正する | 高 |
| 支出保存機能 | 確認した支出データをDBに保存する | 高 |
| 支出一覧表示機能 | 登録した支出を一覧で確認する | 高 |
| 支出詳細表示機能 | 1件の支出情報を詳しく確認する | 中 |
| 支出編集機能 | 保存済みの支出情報を修正する | 中 |
| 支出削除機能 | 不要な支出データを削除する | 中 |
| 月次合計表示機能 | 今月の支出合計を表示する | 高 |
| カテゴリー分類機能 | 食費・日用品・交通費などに分類する | 高 |
| カテゴリー別集計機能 | カテゴリーごとの合計金額を表示する | 中 |

## 今回は作らない機能

| 機能名 | 作らない理由 |
|---|---|
| 銀行・カード連携 | セキュリティや外部サービス連携が難しいため |
| 予算設定機能 | MVPの範囲を超えるため |
| 家族共有機能 | 権限管理が複雑になるため |
| 複数端末同期機能 | Webアプリとしてログイン管理するため、専用機能は後回し |
| 商品ごとの細かい分類 | OCR処理と分類処理の難易度が高くなるため |
| AIによる節約アドバイス | メイン機能ではないため |

## 画面構成

| 画面名 | 目的 | 主な機能 |
|---|---|---|
| トップ画面 | アプリの説明とログイン・新規登録への導線 | アプリ説明、ログインボタン、新規登録ボタン |
| 新規登録画面 | 新しいユーザーを登録する | ユーザー名、メールアドレス、パスワード登録 |
| ログイン画面 | 登録済みユーザーがログインする | メールアドレスまたはユーザー名、パスワード入力 |
| ホーム画面 | 今月の支出状況を確認する | 今月の支出合計、レシート件数、最近の支出表示 |
| レシート登録画面 | レシート画像を登録する | カメラ撮影、画像アップロード、OCR実行 |
| OCR結果確認画面 | OCRで読み取った内容を確認・修正する | 店名、日付、合計金額、カテゴリー確認 |
| 保存完了画面 | レシート登録完了を知らせる | 登録内容の表示、続けて登録、ホームへ戻る |
| 支出一覧画面 | 登録済みの支出を一覧表示する | 日付、店名、カテゴリー、金額の一覧 |
| 支出詳細画面 | 1件の支出を詳しく確認する | レシート画像、OCR全文、登録内容の表示 |
| 支出編集画面 | 保存済みの支出を修正する | 店名、日付、金額、カテゴリー編集 |
| 月次集計画面 | 月ごとの支出を確認する | 月次合計、カテゴリー別合計 |
| マイページ | ユーザー情報やログアウト操作を行う | ユーザー情報表示、ログアウト |

## 画面遷移

```text
トップ画面
 ├─ 新規登録画面
 │    └─ ホーム画面
 └─ ログイン画面
      └─ ホーム画面
            ├─ レシート登録画面
            │    └─ OCR結果確認画面
            │          └─ 保存完了画面
            │                ├─ ホーム画面
            │                └─ レシート登録画面
            ├─ 支出一覧画面
            │    └─ 支出詳細画面
            │          └─ 支出編集画面
            ├─ 月次集計画面
            └─ マイページ
```

## 技術構成

| 分類 | 使用技術候補 |
|---|---|
| フロントエンド | React + Vite |
| バックエンド | Python / Django |
| データベース | SQLite / PostgreSQL |
| 認証 | Django標準認証機能を利用したセッション認証 |
| OCR | Tesseract.js（ブラウザ内のWebAssembly / Web Worker） |
| デプロイ | Vercel（フロントエンド） / Render Web Service（バックエンド） / Render PostgreSQL |

## 技術構成の理由

- アプリ開発未経験でも、スマホ対応Webアプリなら実装しやすい
- Djangoで認証、DB、画像アップロード、集計処理をまとめて実装できる
- OCRはTesseract.jsをブラウザ内で実行し、画像を外部サーバーへ送らず無課金で利用できる
- Bootstrapを使うことで、画面デザインを短時間で整えやすい
- 発表時に「レシート登録 → OCR → 保存 → 月次合計反映」の流れを見せやすい

## データベース設計案

### User

Django標準のUserモデルを使用します。

### Receipt

| カラム名 | 型の例 | 内容 |
|---|---|---|
| id | Integer | レシートID |
| user | ForeignKey | 登録したユーザー |
| shop_name | CharField | 店名 |
| total_amount | IntegerField | 合計金額 |
| purchased_at | DateField | 購入日 |
| category | ForeignKey | カテゴリー |
| image | ImageField | レシート画像 |
| raw_ocr_text | TextField | OCRで読み取った全文 |
| created_at | DateTimeField | 登録日時 |
| updated_at | DateTimeField | 更新日時 |

### Category

| カラム名 | 型の例 | 内容 |
|---|---|---|
| id | Integer | カテゴリーID |
| name | CharField | カテゴリー名 |
| keywords | TextField | 自動分類用キーワード |

## カテゴリー例

| カテゴリー | 判定キーワード例 |
|---|---|
| 食費 | スーパー、食品、弁当、パン、牛乳、コンビニ |
| 日用品 | 薬局、洗剤、ティッシュ、ドラッグストア |
| 交通費 | 電車、バス、交通、IC |
| その他 | 判定できないもの |

## 読み取り権限・書き込み権限

| データ     | 読み取り | 書き込み     |
| ------- | ---- | -------- |
| ユーザー情報  | 本人のみ | 本人のみ     |
| レシート画像  | 本人のみ | 本人のみ     |
| 支出データ   | 本人のみ | 本人のみ     |
| 月別集計データ | 本人のみ | システム自動更新 |

## セットアップ手順

以下はDjangoで開発する場合の基本的なセットアップ手順です。

### 1. リポジトリをクローン

```bash
git clone <repository-url>
cd <repository-name>
```

### 2. 仮想環境を作成

Windowsの場合：

```bash
python -m venv venv
venv\Scripts\activate
```

macOS / Linuxの場合：

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. 必要なライブラリをインストール

```bash
pip install -r requirements.txt
```

`requirements.txt` がまだない場合は、以下のように作成します。

```bash
pip freeze > requirements.txt
```

### 4. 環境変数を設定

プロジェクト直下の `.env.example` と `frontend/.env.example` を参考に、ローカルでは必要な環境変数を設定します。
このリポジトリでは `.env` を自動読み込みしないため、ローカルで使う場合はシェル、IDE、または起動ツール側で読み込ませます。

```env
SECRET_KEY=your-secret-key
DEBUG=True
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

注意：`.env` や本番環境の接続情報はGitHubにアップロードしないでください。

## デプロイ設定

### フロントエンド: Vercel

Vercel では `frontend` ディレクトリをプロジェクトルートとして設定します。

| 項目 | 値 |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment Variables | `VITE_API_BASE_URL=/api`（本番ビルドの接続先も `/api` 固定） |

`frontend/vercel.json` は `/api/:path*` を `https://amber-api-usdz.onrender.com/api/:path*` へ転送し、その後に SPA の `index.html` フォールバックを適用します。ブラウザから見たAPIと画面のオリジンが一致するため、Safariのトラッキング防止やChrome・Edgeのプライベートブラウズでも、クロスサイトCookieに依存せず認証できます。

本番では、古い `VITE_API_BASE_URL` にRender URLが残っていても `/api` を使用します。Vercel Dashboardの設定も `VITE_API_BASE_URL=/api` に統一してください。転送先を変える場合は `frontend/vercel.json` の `destination` を変更し、再デプロイします。Previewも同じRenderへ転送するため、確認にはテスト用アカウントを使ってください。別の検証用バックエンドを使う場合は、検証用ブランチの `destination` を変更します。

ローカルの `npm run dev` は従来どおり `http://localhost:8000/api` に接続します。必要に応じて `frontend/.env.local` の `VITE_API_BASE_URL` で開発用APIを指定できます。`npm run preview` は本番ビルドの `/api` を使用しますが、Vercel Rewriteを実行しないため、認証確認には開発サーバーかVercel Previewを使います。

### バックエンド: Render Web Service

Render では `render.yaml` を使って Django API と Render PostgreSQL を定義します。
実際の秘密情報や本番URLは Render Dashboard の Environment Variables で管理し、GitHub にはコミットしません。

| 環境変数 | 内容 |
|---|---|
| `SECRET_KEY` | Renderで生成、またはDashboardで設定 |
| `DEBUG` | 本番では `False` |
| `DATABASE_URL` | Render PostgreSQL の接続文字列 |
| `ALLOWED_HOSTS` | `.onrender.com` または利用するバックエンドドメイン |
| `FRONTEND_ORIGIN` | Vercel のフロントエンドURL |
| `CORS_ALLOWED_ORIGINS` | Vercel のフロントエンドURL |
| `CSRF_TRUSTED_ORIGINS` | Vercel のフロントエンドURL |
| `SESSION_COOKIE_SAMESITE` | `Lax`（同一オリジンの `/api` を使用） |
| `CSRF_COOKIE_SAMESITE` | `Lax`（同一オリジンの `/api` を使用） |
| `SESSION_COOKIE_SECURE` | 本番では `True` |
| `CSRF_COOKIE_SECURE` | 本番では `True` |

既存のRenderサービスではDashboardの環境変数も確認してください。`render.yaml` の変更だけでは、手動設定済みの値が更新されない場合があります。`DEBUG=False` のとき、Secure Cookieの既定値は `True` です。明示的な環境変数がある場合はそちらが優先されます。

`CSRF_TRUSTED_ORIGINS` に実際のVercel公開URL（スキームを含み、末尾のパスは含めない）を設定します。Previewで認証を確認する場合は、そのPreviewのURLもカンマ区切りで追加します。`CORS_ALLOWED_ORIGINS` はローカルでDjangoへ直接接続するときに必要です。本番の同一オリジン通信ではブラウザ側のCORS許可は不要ですが、既存設定は残せます。

転送時のHostはRender側ドメインを使うため、`ALLOWED_HOSTS` はRender側の値を維持します。`SECURE_PROXY_SSL_HEADER` は `X-Forwarded-Proto: https` によりHTTPSを認識します。CookieはDjangoの既定どおりDomainなし・Path `/` とし、Renderドメインへ固定しません。ブラウザはVercelから返る `Set-Cookie` をVercelホストのCookieとして保存します。CSRF保護は維持し、Axiosは `csrftoken` を `X-CSRFToken` に設定します。

### 同一オリジン認証の公開環境確認

デプロイ後に、Mac Safariの通常／プライベート、Chromeの通常／シークレット、Edgeの通常／InPrivateで以下を確認します。Safariの「サイト越えトラッキングを防ぐ」やサードパーティCookieの制限は変更しません。

1. 新規登録 → ログイン → 再読み込み → 支出一覧 → ログアウトを実行する（登録成功後は既存仕様どおりログイン画面へ進む）。
2. NetworkでCSRF取得・登録・ログイン・ユーザー取得・支出一覧・ログアウトがすべて公開URLの `/api/*` を使用し、Renderへ直接通信していないことを確認する。
3. `csrftoken` / `sessionid` が公開ホストに保存され、Domainなし・Path `/`・Secure・SameSite `Lax` であることを確認する。`Set-Cookie` の `Max-Age` / `Expires` と保存後の有効期限がDjangoの `SESSION_COOKIE_AGE` / `CSRF_COOKIE_AGE` に一致することも確認する。ログイン後のCSRFトークン更新、後続リクエストへのCookieと `X-CSRFToken` の送信も確認する。
4. CSRF取得・ログイン成功は200、登録成功は201、ログアウト成功は204、ログアウト後のユーザー取得は403、重複登録は400となり、APIのJSONがHTMLに置き換わらないことを確認する。`Content-Type`、`Set-Cookie`、`Vary` などの必要なレスポンスヘッダーが転送後も保持されることと、ログアウトで `sessionid` が削除されることも確認する。
5. `/login` や `/expenses` の直接アクセス・再読み込みがSPAとして表示されることを確認する。

プライベートウィンドウをすべて閉じた後のCookie削除はブラウザの仕様です。認証維持は同じプライベートセッション内の再読み込みで確認します。自動テストはDjangoのCSRF・Cookie設定とAPIクライアントの通信設定を検証しますが、Vercel経由のヘッダー・Cookie転送と各ブラウザの実機確認は別途必要です。

この同一オリジン化はIssue #41で追跡します（#45のSafari条件を統合済み）。Cookieを読めない場合のCSRF永続キャッシュ廃止は別のIssue #39、パスワード案内は #42で扱います。同一オリジン化の確認だけで、それらの修正完了とは判断しません。

本番反映後は、以下の結果をIssue #30（本番統合）へ引き継ぎ、#31（MVP最終QA）で参照できるようにします。環境変数は名前と確認結果のみ記録し、秘密値は記載しません。

- VercelとRenderそれぞれに反映されたコミットSHA、反映日時、環境、PR #46との対応
- `VITE_API_BASE_URL`、Origin設定、Cookie設定などの環境変数名と確認結果
- Mac Safari通常／プライベート、Chrome通常／シークレット、Edge通常／InPrivateのブラウザ・OSバージョンと、登録・ログイン・再読み込み・支出一覧・ログアウトの結果
- APIステータス・レスポンスヘッダー・Cookie属性と有効期限・SPA直接アクセスの確認結果、および未確認項目と失敗時の再現手順

Render Web Service と Render PostgreSQL が同じ workspace かつ同じ region にある場合は、PostgreSQL の internal connection string を使います。
別 region や別 workspace の internal connection string は名前解決できないため、同じ region にそろえるか、必要に応じて external connection string を使います。

### OCR: 無課金のフロントエンド構成

レシート画像はDjango APIへアップロードせず、Vercelで配信するReactアプリ上のTesseract.jsで解析します。日本語・英語の学習データは初回利用時にブラウザへダウンロードされ、以後はキャッシュが利用されます。OCR用API、共有画像ストレージ、Render Background Worker、外部OCR APIの利用料は不要です。

複数画像を続けて解析するときは、同じWeb Workerを再利用します。認識は元画像の自動レイアウト解析と、グレースケール・コントラスト強調・自動回転を施した単一ブロック解析の2パスで行い、店名・購入日・合計金額を統合します。「合計」の文字が崩れた場合は、税込対象額や繰り返し出現する通貨額から合計候補を補完します。

認識した店名・購入日・合計金額・OCR全文と信頼度だけを、ユーザーが内容を確認して支出を保存するときにDjango APIへ送信します。レシート画像そのものは送信・保存しません。信頼度が70%未満の場合は、入力値とレシート画像の照合を促す警告を表示します。

初回の学習データ取得にはネットワーク接続が必要です。初回から完全オフラインにする場合は、Tesseract.jsのWorker、WASM、`jpn` / `eng`の`traineddata`を自サイトから配信する構成へ変更してください。

### Render PostgreSQL 接続確認

- Web Service と PostgreSQL が同じ Render workspace にあること
- Web Service と PostgreSQL が同じ region にあること
- `DATABASE_URL` が古いDBや別regionの internal URL を指していないこと
- Blueprintを使う場合は `render.yaml` の `fromDatabase` から `DATABASE_URL` を設定していること
- Dashboardで手動設定する場合は、接続文字列を再コピーして保存後に再デプロイすること

### 5. マイグレーションを実行

```bash
python manage.py makemigrations
python manage.py migrate
```

### 6. 管理者ユーザーを作成

```bash
python manage.py createsuperuser
```

### 7. 開発サーバーを起動

```bash
python manage.py runserver
```

ブラウザで以下にアクセスします。

```text
http://127.0.0.1:8000/
```

## ブランチ運用ルール

基本的に、`main` ブランチへ直接作業しないようにします。

### ブランチ名の例

| 作業内容 | ブランチ名の例 |
|---|---|
| 機能追加 | feature/login |
| 画面作成 | feature/home-screen |
| バグ修正 | fix/receipt-upload |
| ドキュメント修正 | docs/readme |
| デザイン調整 | design/dashboard |

### 作業の流れ

```bash
git checkout main
git pull origin main
git checkout -b feature/作業名
```

作業後：

```bash
git add .
git commit -m "ログイン画面を作成"
git push origin feature/作業名
```

その後、GitHubでPull Requestを作成します。

## コミットメッセージルール

コミットメッセージは、何をしたか分かるように書きます。

### 例

```text
ログイン画面を作成
レシート画像アップロード機能を追加
月次合計の表示処理を実装
READMEにセットアップ手順を追加
OCR結果確認画面のレイアウトを修正
```

余裕があれば、以下のような接頭辞を付けます。

| 接頭辞 | 意味 |
|---|---|
| feat | 新機能追加 |
| fix | バグ修正 |
| docs | ドキュメント修正 |
| style | デザインや見た目の修正 |
| refactor | 処理の整理 |
| chore | 設定や環境まわりの変更 |

例：

```text
feat: レシート画像アップロード機能を追加
fix: ログインできない不具合を修正
docs: READMEにセットアップ手順を追加
```

## チーム内の連絡・更新ルール

## 連絡ルール

- 作業を始める前に、誰がどの機能を担当するか共有する
- 困ったことがあれば早めにチーム内で相談する
- 仕様を変更する場合は、必ずチーム全体に共有する
- 画面や機能を完成させたら、スクリーンショットや動作内容を共有する
- エラーが出た場合は、エラー文と試したことを一緒に共有する

## 更新ルール

- `main` ブランチに直接pushしない
- 作業前には必ず `git pull origin main` を実行する
- 1つのブランチでは、できるだけ1つの機能だけを作る
- Pull Requestを作ったら、最低1人に確認してもらう
- 動作確認ができてからマージする
- APIキー、パスワード、認証情報はGitHubに載せない

## 進捗共有の例

```text
【今日やったこと】
ログイン画面のHTMLを作成しました。

【次にやること】
Djangoのログイン処理とつなげます。

【困っていること】
ログイン失敗時のエラーメッセージ表示方法を確認中です。
```

## 役割分担案

| 担当 | 内容 |
|---|---|
| フロントエンド担当 | 画面作成、CSS調整、スマホ対応 |
| バックエンド担当 | Djangoの処理、DB、認証 |
| OCR担当 | Tesseract.js連携、ブラウザ内のOCR結果処理 |
| DB担当 | モデル設計、マイグレーション、データ保存 |
| 発表・資料担当 | 発表スライド、デモ準備、README整理 |

実際の担当はチーム内で相談して決定します。

## 開発の優先順位

1. ユーザー登録・ログイン
2. ホーム画面
3. レシート画像アップロード
4. OCR読み取り
5. OCR結果確認画面
6. 支出保存
7. 支出一覧表示
8. 月次合計表示
9. 編集・削除
10. カテゴリー別集計

## 発表デモの流れ

1. ユーザーがログインする
2. レシート画像を撮影またはアップロードする
3. OCRによって文字を読み取る
4. 店名・日付・合計金額・カテゴリーが表示される
5. ユーザーが内容を確認して保存する
6. 今月の支出合計に金額が反映される

## 注意事項

- 実際のレシートには個人情報が含まれる場合があるため、発表ではサンプル画像を使用する
- APIキーや認証情報はGitHubにアップロードしない
- OCRの読み取り結果は必ず確認画面で修正できるようにする
- カメラ機能がうまく動かない場合に備えて、画像アップロードにも対応する
- MVPの完成を優先し、追加機能は時間に余裕がある場合のみ実装する

### React + Djangoでセッション認証を使う場合の注意点

- ReactとDjangoを分ける場合、少しだけ設定が必要
- ReactからDjangoへログインリクエストを送る
- Django側でセッションを作成する
- Reactの通信でCookieを送る
- CSRF対策をする
- CORS設定を行う

```text
React
 ↓ ログイン情報を送信
Django
 ↓ セッションを作成
ブラウザ
 ↓ Cookieを保持
React
 ↓ Cookie付きでAPI通信
Django
 ↓ ログイン中のユーザーとして処理
```

## 今後の課題

- OCR精度の向上
- 店名や商品名からのカテゴリー自動分類精度の向上
- グラフ表示機能の追加
- 予算設定機能の追加
- 支出の検索・絞り込み機能の追加
- スマホ画面のUI改善

## ライセンス

このプロジェクトは卒業制作として作成しています。

