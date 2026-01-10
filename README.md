# このソフトウェアについて
このソフトウェアは、空想世界などの戦記録における戦力配置などを配置・再現することでその状況を同時に共有できる支援システムを提供します

# 技術スタック (Technology Stack)

## Frontend
- **React** (Vite)
- **Libraries**: `react-router-dom`, `react-draggable`, `socket.io-client`, `jszip`

## Backend
- **Node.js** (Express)
- **Real-time**: `socket.io`

# 使い方(開発環境)
ターミナルが2つ必要です。
1つ目のターミナル
`npm run dev`

2つ目のターミナル
`node ./index.js` (または `cd server && node index.js`)

# 本番環境構築・インストール

詳細な手順（Ubuntu/CentOS別のセットアップ方法など）は [INSTALL.md](./INSTALL.md) を参照してください。

## 簡易手順
1. リポジトリのクローン
2. フロントエンドの依存関係インストールとビルド
   ```bash
   npm install
   npm run build
   ```
3. バックエンドの依存関係インストールと起動
   ```bash
   cd server
   npm install
   node index.js
   ```
4. フロントエンド(`dist`フォルダ)の配信

※ サーバーはポート `3001` でバックエンドAPI待ち受け、フロントエンドは任意のWebサーバーで配信可能です。

# ソフトウェアの使い方(アクセスなど)

1. http://<IPアドレス>:3000 にアクセスしてください。 (開発サーバーの場合)
   ※ 本番環境の場合は配信しているWebサーバーのアドレスにアクセスしてください。

# 改良提案などについて
随時Pull Requestを受け付けています。どしどし応募・意見などいただければ...!