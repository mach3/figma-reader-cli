# figma-reader

Figma のデザインデータをコマンドラインから取得・処理する CLI ツール。
AI エージェントがサブプロセスとして実行し、正確で必要十分なデザイン情報を取得することを主な目的として設計されています。

## 特徴

- **デザインの取得・閲覧**: Figma URL からノードツリー、スタイル、コンポーネント情報を取得
- **画像エクスポート**: PNG / SVG / PDF 形式でのエクスポート、ファイルダウンロードに対応
- **AI エージェント向け**: デフォルトで JSON 出力。サブプロセス実行を前提とした設計
- **人間にも使いやすい**: `--pretty` フラグで人間向けのテキスト出力に切り替え可能

## インストール

```bash
npm install -g figma-reader
```

## セットアップ

Figma API を利用するには [Personal Access Token](https://www.figma.com/developers/api#access-tokens) が必要です。

### 方法 1: `login` コマンド（推奨）

対話的にトークンを入力し、設定ファイル（`~/.config/figma-reader/config.json`）に保存します。

```bash
figma-reader login
figma-reader login --pretty
```

| オプション | 説明 |
|-----------|------|
| `--pretty` | 人間向けのテキスト形式で出力 |

### 方法 2: 環境変数

環境変数 `FIGMA_TOKEN` を設定します。環境変数は設定ファイルより優先されます。

```bash
export FIGMA_TOKEN="figd_xxxxxxxxxxxx"
```

## 使い方

### `me` - ユーザー情報の取得

認証済みユーザーの情報を表示します。

```bash
figma-reader me
figma-reader me --pretty
```

### `inspect` - デザインコンテキストの取得

Figma ノード URL からデザイン情報（ノードツリー・スタイル・コンポーネント）を取得します。

```bash
figma-reader inspect "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--pretty` | 人間向けのツリー表示で出力 | `false` |
| `--depth <N>` | ノードツリーの深さを制限（正の整数） | 制限なし |
| `--geometry` | ベクターデータ（パス情報）を含める | `false` |

### `export` - 画像エクスポート

Figma ノードを画像としてエクスポートします。

```bash
# URL を取得
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"

# SVG 形式でファイルにダウンロード
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --format svg --download

# スケール指定・出力先指定
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --scale 2 --download --output ./images
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--format <fmt>` | 出力形式（`png`, `svg`, `pdf`） | `png` |
| `--scale <N>` | スケール（0.01〜4、png/pdf のみ） | `1` |
| `--ids <ids>` | 追加ノード ID（カンマ区切り） | - |
| `--download` | ファイルとしてダウンロード | `false` |
| `--output <dir>` | ダウンロード先ディレクトリ | `.` |
| `--pretty` | 人間向けのテキスト形式で出力 | `false` |

## AI エージェント連携

このツールは AI エージェントからの利用を前提に設計されています。

- **デフォルトで JSON 出力**: すべてのコマンドはデフォルトで機械可読な JSON を stdout に出力します
- **エラー出力**: エラーは JSON 形式で stderr に出力されます
- **exit code**: 成功時は `0`、失敗時は `1` を返します
- **トークン設定**: 環境変数 `FIGMA_TOKEN` での認証が推奨です

## ライセンス

[MIT](./LICENSE)
