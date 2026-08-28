require "sinatra/base"
require_relative "../../lib/scenario_target"

target = SinatraCovers::ScenarioTarget.from_environment
require target.app_path

run SinatraCoversApp
