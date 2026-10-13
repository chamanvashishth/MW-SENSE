#pragma once
#include <string>
#include <regex>

class JsonValue {
 public:
  explicit JsonValue(std::string value) : value_(std::move(value)) {}
  const char* operator|(const char* fallback) const {
    return value_.empty() ? fallback : value_.c_str();
  }
 private:
  std::string value_;
};

class JsonDocument {
 public:
  JsonValue operator[](const char* key) const {
    const std::regex expression(std::string("\\\"") + key + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
    std::smatch match;
    if (std::regex_search(source_, match, expression)) return JsonValue(match[1].str());
    return JsonValue("");
  }
  std::string source_;
};

inline bool deserializeJson(JsonDocument& document, const String& input) {
  if (input.empty() || input.front() != '{' || input.find('}') == std::string::npos) return true;
  document.source_ = input;
  return false;
}
