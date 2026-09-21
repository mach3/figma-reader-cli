# figma-reader

Figma のデザインデータをコマンドラインから取得・処理する CLI ツール。
AI エージェントがサブプロセスとして実行し、正確で必要十分なデザイン情報を取得することを主な目的として設計されています。

## 特徴

- **デザインの取得・閲覧**: Figma URL からノードツリー、スタイル、コンポーネント情報を取得
- **画像エクスポート**: PNG / SVG / PDF 形式でのエクスポート、ファイルダウンロードに対応
- **AI エージェント向け**: デフォルトで JSON 出力。サブプロセス実行を前提とした設計
- **人間にも使いやすい**: `--pretty` フラグで人間向けのテキスト出力に切り替え可能

## インストール

**Node.js 22.12 以降**が必要です。Node 18 / 20 は EOL のためサポート対象外です。

サポート対象プラットフォームは **macOS / Linux** です。Windows はベストエフォートで、動作は妨げませんが正式なサポート対象ではなく、以下の既知の差異は解消しません。

- 設定ファイルは `%APPDATA%` ではなく、ホームディレクトリ配下の `.config/figma-reader/config.json`（Windows では `C:\Users\<name>\.config\figma-reader\config.json`）に置かれます
- `~` から始まるパス（`--dest ~/.codex/skills/figma-reader-cli` など）は `cmd.exe` / PowerShell では展開されません。絶対パスを指定してください

```bash
npm install -g figma-reader
```

## セットアップ

Figma API を利用するには [Personal Access Token](https://www.figma.com/developers/api#access-tokens) が必要です。

### 方法 1: `auth login` コマンド（推奨）

対話的にトークンを入力し、設定ファイル（`~/.config/figma-reader/config.json`）に保存します。
パスはホームディレクトリから解決されるため、Windows では `C:\Users\<name>\.config\figma-reader\config.json` になります。上記の `~` は表記上のもので、`cmd.exe` / PowerShell は展開しないため、自分でパスを入力する場合は注意してください。
複数のトークンをプロファイル名付きで保存し、いつでも切り替えられます。

```bash
figma-reader auth login                # プロファイル名は Figma アカウントの email（ローカル部）から自動決定
figma-reader auth login --name work    # プロファイル "work" として保存
figma-reader login                     # `auth login` のエイリアス
```

| オプション | 説明 |
|-----------|------|
| `--name <name>` | トークンを保存するプロファイル名。省略時は Figma API から取得したアカウント email のローカル部を使う（副作用としてトークンが検証される） |
| `--pretty` | 人間向けのテキスト形式で出力 |

#### 複数トークンの管理

```bash
figma-reader auth list             # 保存済みプロファイル一覧（トークンはマスク表示）
figma-reader auth switch work      # アクティブなプロファイルを切り替え
figma-reader auth status           # アクティブなトークンを Figma API で検証
```

最初に保存したトークンが自動的にアクティブになります。すべてのコマンド（`me`, `inspect`, `export`）はアクティブなトークンを使用します。

切り替えずに一度だけ別のプロファイルを使う場合は、`me` / `inspect` / `export` / `auth status` に `--profile <name>` を指定します。優先順位: `--profile` > `FIGMA_TOKEN` > アクティブプロファイル。

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
| `--styles` | スタイル特化の JSON 出力。ノイズフィールドを除去し fills / strokes / effects / レイアウト / テキストスタイルを保持。`--pretty` / `--geometry` とは併用不可 | `false` |
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

### `install` - AI エージェント用スキルのインストール

AI エージェント用のスキルファイルをカレントディレクトリにインストールします。これにより AI エージェントが figma-reader の使い方を理解できるようになります。

```bash
# Claude Code（デフォルト）
figma-reader install

# その他のエージェント
figma-reader install --agent codex
figma-reader install --agent antigravity

# 任意のパス（未対応エージェント向け）
figma-reader install --dest .windsurf/skills/figma-reader-cli
```

同梱スキルは SKILL.md 形式（Agent Skills）なので、変換なしでそのままコピーされます。

| `--agent` | インストール先 |
|-----------|---------------|
| `claude`（デフォルト） | `.claude/skills/figma-reader-cli/` |
| `codex` | `.agents/skills/figma-reader-cli/` |
| `antigravity` | `.agents/skills/figma-reader-cli/` |

`codex` と `antigravity` は同じディレクトリに解決されます。どちらもリポジトリスコープのスキルを `.agents/` 配下から探すためです。Codex CLI のユーザースコープに入れたい場合は `--dest ~/.codex/skills/figma-reader-cli` を使ってください。Windows の `cmd.exe` / PowerShell は `~` を展開しないため、絶対パスを指定してください。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--agent <name>` | インストール対象のエージェント（`claude`, `codex`, `antigravity`） | `claude` |
| `--dest <path>` | 任意のパスにインストール（`--agent` とは併用不可） | - |
| `--pretty` | 人間向けのテキスト形式で出力 | `false` |

## AI エージェント連携

このツールは AI エージェントからの利用を前提に設計されています。

- **デフォルトで JSON 出力**: すべてのコマンドはデフォルトで機械可読な JSON を stdout に出力します
- **エラー出力**: エラーは JSON 形式で stderr に出力されます
- **exit code**: 成功時は `0`、失敗時は `1` を返します
- **トークン設定**: 環境変数 `FIGMA_TOKEN` での認証が推奨です
- **スキルインストール**: `figma-reader install` でスキルファイルをインストール可能（`--agent` で Codex CLI・Antigravity も指定可）

## ライセンス

[MIT](./LICENSE)
