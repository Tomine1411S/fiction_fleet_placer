# インストールとセットアップガイド

このドキュメントでは、UbuntuおよびCentOS環境における**Fiction Fleet Placer**のセットアップ手順について解説します。

## 技術スタック (Technology Stack)

### フロントエンド (Frontend)
- **Framework**: React (Vite)
- **Language**: JavaScript (JSX)
- **Libraries**:
  - `react-router-dom`: ルーティング
  - `react-draggable`: 要素のドラッグ操作
  - `socket.io-client`: リアルタイム通信 (クライアント)
  - `jszip`, `file-saver`: ファイル保存・圧縮処理

### バックエンド (Backend)
- **Runtime**: Node.js
- **Framework**: Express
- **Real-time**: Socket.io
- **Libraries**:
  - `cors`: Cross-Origin Resource Sharing

---

## 前提条件 (Prerequisites)

- **Node.js**: v18以上推奨
- **npm** (Node Package Manager)

---

## 1. 環境構築 (Node.jsのインストール)

### Ubuntu (Debian系) の場合

公式リポジトリまたはNodeSourceを使用して最新のLTS版をインストールすることを推奨します。

```bash
# 前提パッケージのインストール
sudo apt update
sudo apt install -y curl git unzip

# NodeSourceセットアップ (Node 20.xの場合)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Node.jsのインストール
sudo apt install -y nodejs

# バージョン確認
node -v
npm -v
```

### CentOS (RHEL系) の場合

CentOS 7/8/9 Stream または RHEL互換OSでの手順です。

```bash
# 前提パッケージのインストール
sudo dnf install -y curl git unzip

# NodeSourceセットアップ (Node 20.xの場合)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -

# Node.jsのインストール
sudo dnf install -y nodejs

# バージョン確認
node -v
npm -v
```

---

## 2. アプリケーションのセットアップ

リポジトリをクローンし、依存関係をインストールします。

```bash
# リポジトリのクローン (HTTPS)
git clone https://github.com/Tomine1411S/fiction_fleet_placer.git
cd fiction_fleet_placer/fiction_fleet_placer
```

### フロントエンドの準備

```bash
# 依存関係のインストール
npm install

# 本番用ビルド (distディレクトリが生成されます)
npm run build
```

### バックエンドの準備

```bash
# サーバーディレクトリへ移動
cd server

# 依存関係のインストール
npm install

# ルートディレクトリへ戻る
cd ..
```

---

## 3. アプリケーションの起動

### 開発環境 (Development)

ターミナルを2つ開き、それぞれで以下を実行します。

**ターミナル1: フロントエンド**
```bash
npm run dev
```

**ターミナル2: バックエンド**
```bash
cd server
node index.js
```

### 本番環境 (Production)

本番環境ではバックエンドサーバーを永続的に起動し、フロントエンドの静的ファイル(`dist`)を配信します。

#### バックエンドの起動 (永続化推奨)
`pm2` 等のプロセス管理ツールを使用することをお勧めしますが、簡易的には以下で起動します。

```bash
cd server
# バックグラウンド実行の例
nohup node index.js > server.log 2>&1 &
```

#### フロントエンドの配信
ビルドされた `dist` ディレクトリの中身を Nginx や Apache などのWebサーバーで配信してください。

簡易的な確認には `serve` パッケージなどが利用できます。

```bash
# serveのインストール
npm install -g serve

# distフォルダをポート3000で配信 (SPAモード)
serve -s dist -p 3000
```

ポート設定などの詳細は `server/index.js` および `vite.config.js` を確認してください。
