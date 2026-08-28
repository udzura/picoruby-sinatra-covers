# picoruby-sinatra-covers

Sinatra 4.2.1 の `Sinatra::Base` を PicoRuby 上で動かすための mrbgem です。
名前は、PicoRuby が Sinatra を cover することと、楽曲の cover を掛けています。

現在の最小スコープは次のとおりです。

- `Sinatra::Base` の modular style
- GET / POST と Mustermann による named parameter
- query string と `application/x-www-form-urlencoded`
- 文字列、status、headers からなる Rack response
- 404 response

session、Rack Protection、template engine、static files、self-hosted server はまだ対象外です。
とくに session は明示的に `false` にしています。

## Dependencies

- PicoRuby
- `udzura/mruby-rack`
- `udzura/mruby-mustermann`
- Sinatra 4.2.1（git submodule）

アプリケーション側の build config では、依存を含めて次のように追加します。

```ruby
conf.gem github: "udzura/mruby-mustermann"
conf.gem github: "udzura/mruby-rack"
conf.gem github: "udzura/picoruby-sinatra-covers"
```

## Example

```ruby
class App < Sinatra::Base
  get "/hello/:name" do
    "Hello, #{params[:name]}"
  end
end
```

Worker adapter には通常の Rack app と同じく `App` を登録します。

## Test

隣接する PicoRuby、`mruby-rack`、`mruby-mustermann` checkout を使い、実際の
PicoRuby `mruby` をビルドして smoke test を実行します。

```sh
git submodule update --init --recursive
rake test
```

checkout の場所が異なる場合は `PICORUBY_ROOT`、`MRUBY_RACK_ROOT`、
`MRUBY_MUSTERMANN_ROOT` を設定してください。

## HTTP compatibility covers

`covers/` には、同じ Sinatra application と同じ Ruby assertion を複数の
runtime に対して実行する互換性テストを収録しています。現在は routing、
named parameter、form parameter、response status/header、404 の最小ケースを
対象にしています。

CRuby + Sinatra 4.2.1 を基準実装として実行するには、依存を準備してから
次を実行します。

```sh
BUNDLE_GEMFILE=covers/Gemfile bundle install
rake covers:cruby
```

PicoRuby Worker に対して実行する場合、`covers/backends/worker/` がWasm build、
Ruby bytecode生成、Wrangler起動を担います。Worker mgemは0.2.2に固定してGitHubから
解決するため、spike checkoutは不要です。

```sh
npm ci --prefix covers/backends/worker
PICORUBY_ROOT=/absolute/path/to/picoruby \
rake covers:worker
```

開発中のWorker mgemを検証する場合だけ、
`PICORUBY_WORKER_WASM_GEM_DIR=/absolute/path/to/picoruby-cloudflare-worker-wasm`
でGitHub固定をローカルcheckoutに置き換えられます。

どちらの runbook もserverをbackgroundで起動し、`covers/verify.rb` を実行して
終了時にserverを停止します。互換性ケースは `covers/scenarios/` に集約し、
runtime固有の差は `covers/backends/` とrunbookだけに閉じ込めます。
