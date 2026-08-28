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

PicoRuby Worker に対して実行する場合は、あらかじめ
`picoruby-cloudflare-worker-wasm/spike` の runtime をビルドしてください。
その後、各 checkout の場所を指定して実行します。

```sh
PICORUBY_ROOT=/absolute/path/to/picoruby \
PICORUBY_WORKER_ROOT=/absolute/path/to/picoruby-cloudflare-worker-wasm \
rake covers:worker
```

どちらの runbook もserverをbackgroundで起動し、`covers/verify.rb` を実行して
終了時にserverを停止します。互換性ケースは `covers/scenarios/` に集約し、
runtime固有の差は `covers/backends/` とrunbookだけに閉じ込めます。
