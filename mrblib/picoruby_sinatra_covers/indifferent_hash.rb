module Sinatra
  class IndifferentHash < Hash
    def self.[](*args)
      hash = new
      source = args.length == 1 && args[0].is_a?(Hash) ? args[0] : Hash[*args]
      hash.merge!(source)
    end

    def [](key)
      super(convert_key(key))
    end

    def []=(key, value)
      super(convert_key(key), convert_value(value))
    end
    alias store []=

    def fetch(key, *args, &block)
      super(convert_key(key), *args, &block)
    end

    def key?(key)
      super(convert_key(key))
    end
    alias has_key? key?
    alias include? key?
    alias member? key?

    def delete(key)
      super(convert_key(key))
    end

    def merge!(*hashes)
      hashes.each do |hash|
        hash.each_pair do |key, value|
          converted_key = convert_key(key)
          value = yield(converted_key, self[converted_key], value) if block_given? && key?(converted_key)
          self[converted_key] = value
        end
      end
      self
    end
    alias update merge!

    def merge(*hashes, &block)
      dup.merge!(*hashes, &block)
    end

    private

    def convert_key(key)
      key.is_a?(Symbol) ? key.to_s : key
    end

    def convert_value(value)
      case value
      when Hash
        value.is_a?(self.class) ? value : self.class[value]
      when Array
        value.map { |item| convert_value(item) }
      else
        value
      end
    end
  end
end
