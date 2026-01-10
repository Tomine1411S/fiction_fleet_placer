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

---

## 4. 本番環境構築 (HTTPS / Port 443)

ポート443 (HTTPS) で運用する場合、**Webサーバー (Apache2)** をリバースプロキシとして使用する構成を推奨します。

### 構成概要
- **Apache2**: SSL終端 (HTTPS)、静的ファイル(`/`)配信、WebSocket(`/socket.io/`)転送
- **Node.js**: ポート3001でバックエンドAPIを稼働

### Apache2 セットアップ手順

#### 1. Apache2 と必要モジュールのインストール

##### Ubuntu
```bash
sudo apt update
sudo apt install -y apache2
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl headers
sudo systemctl restart apache2
```

##### CentOS / RHEL
```bash
sudo dnf install -y httpd mod_ssl
# CentOSではデフォルトでproxyモジュール等はロードされますが、confを確認してください
sudo systemctl enable --now httpd
```

#### 2. Apache VirtualHost 設定

`/etc/apache2/sites-available/fiction-fleet.conf` (Ubuntu) または `/etc/httpd/conf.d/fiction-fleet.conf` (CentOS) を作成します。

**設定例:**
※ `your-domain.com` および証明書パスは環境に合わせて変更してください。

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    # HTTPSへリダイレクト
    Redirect permanent / https://your-domain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName your-domain.com

    # SSL設定 (例: Let's Encrypt 等)
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/your-cert.pem
    SSLCertificateKeyFile /etc/ssl/private/your-key.pem

    # ドキュメントルート (フロントエンドのビルド成果物)
    # 事前に: sudo cp -r /path/to/project/dist/* /var/www/html/fiction-fleet/
    DocumentRoot /var/www/html/fiction-fleet

    <Directory /var/www/html/fiction-fleet>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
        # SPAルーティング対応 (React Router)
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteRule ^ index.html [QSA,L]
    </Directory>

    # WebSocket (Socket.io) プロキシ設定
    # Upgradeヘッダーを適切に処理するために必要です
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           ws://localhost:3001/$1 [P,L]
    RewriteCond %{HTTP:Upgrade} !=websocket [NC]
    RewriteRule /(.*)           http://localhost:3001/$1 [P,L]

    # プロキシヘッダー設定
    ProxyPassReverse / http://localhost:3001/
</VirtualHost>
```

#### 3. 設定の反映

```bash
# Ubuntu
sudo a2ensite fiction-fleet
sudo systemctl reload apache2

# CentOS
sudo systemctl restart httpd
```

#### 4. バックエンドの起動

バックエンドサーバーはローカル(3001)で起動しておきます。

```bash
cd server
npm install
# PM2などでの永続化推奨
pm2 start index.js --name "fleet-server"
```

これにより、ブラウザで `https://your-domain.com` にアクセスすると、Apache経由でフロントエンドが表示され、`/socket.io/` 通信も安全にバックエンドへ転送されます。
