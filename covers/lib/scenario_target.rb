module SinatraCovers
  class ScenarioTarget
    NAME_PATTERN = /\A[a-z0-9][a-z0-9_-]*\z/
    COVERS_ROOT = File.expand_path("..", __dir__)

    attr_reader :name

    def self.from_environment
      new(ENV.fetch("COVER_SCENARIO", "basic"))
    end

    def initialize(name)
      unless NAME_PATTERN.match?(name)
        raise ArgumentError, "Invalid cover scenario name: #{name.inspect}"
      end

      @name = name
    end

    def app_path
      resolve("app")
    end

    def scenario_path
      resolve("scenarios")
    end

    private

    def resolve(directory)
      path = File.join(COVERS_ROOT, directory, "#{name}.rb")
      return path if File.file?(path)

      raise ArgumentError, "Cover #{directory} file was not found: #{path}"
    end
  end
end
