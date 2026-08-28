# Minimal `sinatra/json` compatibility backed by mruby-json.
module Sinatra
  module JSON
    class << self
      def encode(object)
        ::JSON.generate(object)
      end
    end

    def json(object, options = {})
      content_type resolve_content_type(options)
      resolve_encoder_action object, resolve_encoder(options)
    end

    private

    def resolve_content_type(options)
      options[:content_type] || settings.json_content_type
    end

    def resolve_encoder(options)
      options[:json_encoder] || settings.json_encoder
    end

    def resolve_encoder_action(object, encoder)
      [:encode, :generate].each do |method|
        return encoder.__send__(method, object) if encoder.respond_to?(method)
      end

      raise "#{encoder} does not respond to #generate nor #encode" unless encoder.is_a?(Symbol)

      object.__send__(encoder)
    end
  end

  Base.set :json_encoder do
    Sinatra::JSON
  end

  Base.set :json_content_type, :json
  Base.helpers JSON
end
