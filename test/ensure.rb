def result
  value = [1, 2, 3]
  "success"
ensure
  value ||= []
  value.each { |v| p v }
end

p result