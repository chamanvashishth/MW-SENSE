#pragma once
#include <map>
#include <string>
#include <utility>

#define FILE_READ "r"
#define FILE_WRITE "w"
#define FILE_APPEND "a"

class File {
 public:
  File() = default;
  File(std::string* data, const char* mode) : data_(data), mode_(mode) {
    if (data_ && mode_ == FILE_WRITE) data_->clear();
  }
  explicit operator bool() const { return data_ != nullptr; }
  size_t println(const String& value) {
    if (!data_) return 0;
    data_->append(value);
    data_->push_back('\n');
    return value.length() + 1;
  }
  size_t print(const String& value) {
    if (!data_) return 0;
    data_->append(value);
    return value.length();
  }
  void flush() {}
  void close() {}
  bool available() const { return data_ && position_ < data_->size(); }
  String readStringUntil(char delimiter) {
    if (!data_) return {};
    const size_t end = data_->find(delimiter, position_);
    if (end == std::string::npos) {
      String result = data_->substr(position_);
      position_ = data_->size();
      return result;
    }
    String result = data_->substr(position_, end - position_);
    position_ = end + 1;
    return result;
  }
  String readString() {
    if (!data_) return {};
    String result = data_->substr(position_);
    position_ = data_->size();
    return result;
  }
 private:
  std::string* data_ = nullptr;
  std::string mode_;
  size_t position_ = 0;
};

class FakeLittleFS {
 public:
  bool begin(bool) { return mount_ok; }
  bool exists(const char* path) const { return files.count(path) != 0; }
  File open(const char* path, const char* mode) {
    if (open_failure) return {};
    if (mode == std::string(FILE_READ) && !exists(path)) return {};
    if (mode == std::string(FILE_APPEND) && !exists(path)) files[path] = "";
    if (mode == std::string(FILE_WRITE)) files[path] = "";
    return File(&files[path], mode);
  }
  bool remove(const char* path) {
    if (remove_failure) return false;
    return files.erase(path) != 0;
  }
  bool rename(const char* from, const char* to) {
    ++rename_calls;
    if (rename_failure_count > 0) {
      --rename_failure_count;
      return false;
    }
    if (fail_rename_on_call > 0 && rename_calls == fail_rename_on_call) return false;
    auto found = files.find(from);
    if (found == files.end()) return false;
    files[to] = found->second;
    files.erase(found);
    return true;
  }
  void reset() {
    files.clear();
    mount_ok = true;
    open_failure = false;
    remove_failure = false;
    rename_failure_count = 0;
    rename_calls = 0;
    fail_rename_on_call = 0;
  }
  std::map<std::string, std::string> files;
  bool mount_ok = true;
  bool open_failure = false;
  bool remove_failure = false;
  int rename_failure_count = 0;
  int rename_calls = 0;
  int fail_rename_on_call = 0;
};

inline FakeLittleFS LittleFS;
