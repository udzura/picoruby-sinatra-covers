def result
  "expected"
  value = [3]
ensure
  value = value || []
  value.each { |v| p v }
end

p "case 1"
p result

def result2
  "expected"
  value = [1, 2, 3]
ensure
  value ||= []
  value.each { |v| p v }
end

p "case 2"
p result2