# Compatibility constants needed while Sinatra 4.2.1 is loaded. Optional
# middleware deliberately stays inert in the first sessions:false target.

ENV = {} unless Object.const_defined?(:ENV)

# Sinatra::Base#set emits tiny getter methods with class_eval(String). Keeping
# mruby-eval out of the Worker runtime is preferable, so translate only that
# generated form to define_method for both Base and application subclasses.
class Module
  alias __picoruby_sinatra_class_eval class_eval

  def class_eval(source = nil, *args, &block)
    return __picoruby_sinatra_class_eval(&block) if source.nil? && block

    if source.is_a?(String)
      match = /\Adef ([a-zA-Z_][a-zA-Z0-9_!?=]*)\(\) (.*); end\z/.match(source)
      if match
        name = match[1]
        expression = match[2]

        if expression.start_with?("!!")
          target = expression[2..-1]
          define_method(name) { !!__send__(target) }
        else
          value = case expression
                  when "true" then true
                  when "false" then false
                  when "nil" then nil
                  when /\A:[a-zA-Z_][a-zA-Z0-9_]*\z/ then expression[1..-1].to_sym
                  when /\A-?[0-9]+\z/ then expression.to_i
                  else
                    raise NotImplementedError, "unsupported Sinatra setting getter: #{expression}"
                  end
          define_method(name) { value }
        end
        return self
      end
    end

    __picoruby_sinatra_class_eval(source, *args, &block)
  end
end

unless Kernel.method_defined?(:require_relative)
  module Kernel
    def require_relative(_path)
      false
    end
  end
end

module Kernel
  # PicoRuby exposes a placeholder caller method that returns nil. Sinatra
  # only needs a filename for route metadata in this target.
  def caller(*_args)
    ["(picoruby):1"]
  end
end

class PicoRubySinatraCallerLocation
  def path
    "(picoruby)"
  end

  def lineno
    1
  end
end

module Kernel
  def caller_locations(*_args)
    [PicoRubySinatraCallerLocation.new]
  end
end

unless Object.const_defined?(:Tempfile)
  class Tempfile
  end
end

unless Object.const_defined?(:SecureRandom)
  module SecureRandom
    module_function

    def hex(length = nil)
      size = length || 16
      "0" * (size * 2)
    end
  end
end

unless Object.const_defined?(:Logger)
  class Logger
    INFO = 1
    FATAL = 4

    attr_accessor :level

    def initialize(*_args)
    end

    def debug(*_args); end
    def info(*_args); end
    def warn(*_args); end
    def error(*_args); end
    def fatal(*_args); end
  end
end

module Rack
  module Session
    class Cookie
      def initialize(*_args)
        raise NotImplementedError, "Rack sessions are not supported"
      end
    end
  end

  class Protection
    def initialize(*_args)
      raise NotImplementedError, "Rack Protection is not supported"
    end

    class HostAuthorization < Protection
    end
  end
end

module Sinatra
  ShowExceptions = Rack::ShowExceptions

  module Middleware
    class Logger
      def initialize(app, *_args)
        @app = app
      end

      def call(env)
        @app.call(env)
      end
    end
  end
end

class String
  unless method_defined?(:encode!)
    def encode!(*_args)
      self
    end
  end
end

# Override the default raise method to maintain $ERROR_INFO similar to Ruby's behavior
# And re-produce past exception in bare raise
alias orig_raise raise
$ERROR_INFO = nil

def raise(*orig_args);
  if orig_args.empty? && !$ERROR_INFO.nil?
    orig_raise($ERROR_INFO)
  elsif orig_args.empty?
    $ERROR_INFO = RuntimeError.new
    orig_raise($ERROR_INFO)
  elsif orig_args[0].is_a?(Exception)
    $ERROR_INFO = orig_args[0]
    orig_raise(*orig_args)
  elsif orig_args[0].is_a?(Class)
    $ERROR_INFO = orig_args[0].new(*orig_args[1..-1])
    orig_raise($ERROR_INFO)
  else
    $ERROR_INFO = RuntimeError.new(*orig_args)
    orig_raise($ERROR_INFO)
  end
end
