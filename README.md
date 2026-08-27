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
