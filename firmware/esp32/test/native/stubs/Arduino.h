#pragma once
#include <cstddef>
#include <string>

class String : public std::string {
 public:
  using std::string::string;
  String() = default;
  String(const std::string& value) : std::string(value) {}
  bool isEmpty() const { return empty(); }
};
