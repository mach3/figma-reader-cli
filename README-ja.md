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

- 設定ファイルとレスポンスキャッシュは、既定では `%APPDATA%` / `%LOCALAPPDATA%` ではなく、ホームディレクトリ配下（`.config/figma-reader/config.json` と `.cache/figma-reader/`）に置かれます。Windows では `C:\Users\<name>\.config\...` および `C:\Users\<name>\.cache\...` に解決されます。キャッシュの保存先は `FIGMA_READER_CACHE_DIR` で変更できます（[キャッシュ](#キャッシュ)を参照）
- キャッシュファイルは、同一マシンの他ユーザーからデザインデータを読まれないよう `0600` で作成されます。Windows は POSIX のパーミッションビットを無視するため、この保護は働きません
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

1 つ以上の Figma ノード URL からデザイン情報（ノードツリー・スタイル・コンポーネント）を取得します。

```bash
figma-reader inspect "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"

# 同一ファイルの複数ノードを 1 回の API リクエストで取得する（URL は 1 本ずつクォートする）
figma-reader inspect "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" "https://www.figma.com/design/XXXXX/FileName?node-id=10-99"
```

すべての URL は同一ファイルに属している必要があります。Figma のリクエストは 1 回につき 1 ファイルしか扱えないため、複数ファイルが混在する場合は **API を呼ぶ前に** エラー終了し、どの URL がどの file key に属するかを出力します:

```json
{ "success": false, "error": "The given URLs span 2 different Figma files; ...", "groups": [{ "fileKey": "ABC123", "urls": ["https://..."] }, { "fileKey": "XYZ789", "urls": ["https://..."] }] }
```

URL の `node-id` はカンマ区切りのリスト（`?node-id=1-2,10-99`）も受け付けます。これは同じノードを別々の URL として渡すのと同等です。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--pretty` | 人間向けのツリー表示で出力 | `false` |
| `--styles` | スタイル特化の JSON 出力。ノイズフィールドを除去し fills / strokes / effects / レイアウト / テキストスタイルを保持。`--pretty` / `--geometry` とは併用不可 | `false` |
| `--depth <N>` | ノードツリーの深さを制限（正の整数） | 制限なし |
| `--geometry` | ベクターデータ（パス情報）を含める | `false` |
| `--refresh` | ローカルキャッシュを使わず Figma API から取得する | `false` |

#### キャッシュ

Figma API のレートリミットは回復までに数時間かかるため、`inspect` のレスポンスはディスクにキャッシュされ、セッションをまたいで再利用されます。キャッシュにヒットするのは file key・ノード ID・`--depth`・`--geometry` のすべてが前回の呼び出しと一致する場合だけで、どれか一つでも違えば 1 リクエストを消費します。有効期限はないため、デザインが変わったと分かっているときに `--refresh` を指定してください。

すべてのレスポンスには、キャッシュ由来かどうかとその古さを示す `_cache` オブジェクトが含まれます:

```json
{ "_cache": { "hit": true, "cached": true, "enabled": true, "fetchedAt": "2026-09-19T04:00:00.000Z", "ageSeconds": 93600, "note": "Served from local cache ..." } }
```

`lastModified` は `fetchedAt` の時点でのファイルの状態を反映したものであり、Figma ファイルの現在の状態ではない点に注意してください。

`inspect` の JSON レスポンスにはさらに `_request.nodeIds`（リクエストが要求したノード ID）が含まれます。重複除去とソートが施されているため、渡した URL と位置で対応するわけではありません。これは `inspect` 固有のフィールドで、`export` は自身の出力で部分的な欠落を報告します。Figma は解決できない ID を `null` で返すこと**も**、キーごと落とすこともあるため、部分的にしか満たされなかったリクエストを検出するには、このリストを `nodes` の**実際に解決したエントリ**と（単にキーとではなく）突き合わせるしかありません:

```json
{ "_request": { "nodeIds": ["10:99", "1:2"] } }
```

`enabled` は、`FIGMA_READER_CACHE` でキャッシュを無効にしている場合に `false` になります（後述）。レスポンスをディスクに書き込めなかった場合は、`note` にエラーコード・キャッシュディレクトリ・対処方法が記載されます。

キャッシュファイルは、次のうち最初に該当する場所に置かれます:

1. `$FIGMA_READER_CACHE_DIR/`（この変数が設定されている場合）
2. `$XDG_CACHE_HOME/figma-reader/`（この変数が絶対パスの場合）
3. `~/.cache/figma-reader/`

他の機能はこれに依存していないため、そのキャッシュディレクトリはいつ削除しても構いません。次回の呼び出しで再取得されるだけです。

##### 環境変数

| 変数 | 説明 |
|------|------|
| `FIGMA_READER_CACHE_DIR` | キャッシュの保存先ディレクトリ。**絶対パスのみ**受け付けます。`~` や変数は展開されず、相対パスはエラーになります。`.envrc` などシェル側で展開した値を渡してください。ファイルはこのディレクトリの直下に置かれ `figma-reader/` は付かないため、**専用のディレクトリ**を指定してください。空文字・空白のみは未設定として扱います。`XDG_CACHE_HOME` より優先されます |
| `FIGMA_READER_CACHE` | キャッシュの有効/無効。`1` / `true` / `on` で有効、`0` / `false` / `off` で無効（大文字小文字・前後の空白は問いません）。未設定・空文字は有効として扱います。それ以外の値はエラーになります |

`FIGMA_READER_CACHE=off` のとき、`inspect` はディスクに一切触れません。キャッシュファイルの読み取り・書き込み・削除を行わず、`FIGMA_READER_CACHE_DIR` も参照しません。毎回 API リクエストを消費し、`--refresh` を付けても挙動は変わりません。既存のキャッシュファイルはそのまま残るため、キャッシュを有効に戻すと、無効にする前に保存したレスポンスが返ることがあります。`--refresh` の代わりにはなりません。

どちらの変数も読むのは `inspect` だけです。不正な値のとき `inspect` は機械可読なエラーで終了しますが、他のコマンドには影響しません。

##### sandbox の中で使う場合

エージェントの sandbox 環境では、ホームディレクトリへの書き込みが拒否されることがあります。たとえば Claude Code の sandbox は、既定では作業ディレクトリとセッションごとの一時ディレクトリにしか書き込みを許さないため、`~/.cache/figma-reader/` に書き込めません。するとキャッシュが溜まらず、毎回 API リクエストを消費し、`_cache.note` に書き込み失敗が表示されます。

対処方法は次のいずれかです:

- sandbox でキャッシュディレクトリへの書き込みを許可する。Claude Code では、user settings（`~/.claude/settings.json`）の `sandbox.filesystem.allowWrite` に追加します。ここに書いたパスは各プロジェクトの設定とマージされるため、全プロジェクトで有効になります:

  ```json
  { "sandbox": { "filesystem": { "allowWrite": ["~/.cache/figma-reader"] } } }
  ```

  これは既定の保存先です。`XDG_CACHE_HOME` や `FIGMA_READER_CACHE_DIR` を設定している場合は、代わりに `_cache.note` に表示されたディレクトリを許可してください。

- `FIGMA_READER_CACHE_DIR` を、sandbox が書き込みを許している絶対パスに向ける。

`sandbox.excludedCommands` に `figma-reader` を追加する方法はお勧めしません。リダイレクトやパイプを含むコマンドには除外が適用されず、エージェントは通常 `inspect` の出力をリダイレクトで保存するためです。詳しくは [Claude Code の sandbox のドキュメント](https://code.claude.com/docs/en/sandboxing.md)を参照してください。

### `export` - 画像エクスポート

Figma ノードを画像としてエクスポートします。

```bash
# URL を取得
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"

# SVG 形式でファイルにダウンロード
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --format svg --download

# スケール指定・出力先指定
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --scale 2 --download --output ./images

# 同一ファイルの複数ノードを 1 回の API リクエストで処理する（URL は 1 本ずつクォートする）
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" "https://www.figma.com/design/XXXXX/FileName?node-id=10-99" --format svg --download
```

`inspect` と同様に、`export` も複数の URL を受け取り、それらが同一ファイルに属していることを要求します。URL 自身のノード ID は `--ids` で渡したものと合わせてエクスポートされます。

**要求したノード ID は必ずすべて出力に現れます。** Figma がレンダリングできなかったノードは、URL 出力モードでは `null` として報告され、`--download` モードでは `failures` に載ってコマンドが exit 1 します。要求したノード数よりファイルが少ないのに成功に見える、という状態にはなりません。

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
