#include "Util.h"
#include <pwd.h>
#include <stdlib.h>
#include <iconv.h>
#include <mutex>

namespace util {

Path homeDirectory(const String& user)
{
    if (char* homeEnv = getenv("HOME"))
        return Path(homeEnv);

    struct passwd pwent;
    struct passwd* pwentp;
    int ret;
    char buf[8192];

    if (user.isEmpty())
        ret = getpwuid_r(getuid(), &pwent, buf, sizeof(buf), &pwentp);
    else
        ret = getpwnam_r(user.constData(), &pwent, buf, sizeof(buf), &pwentp);
    if (ret)
        return Path();
    return Path(pwent.pw_dir);
}

Path homeify(const String& path)
{
    Path copy = path;
    int idx = 0, slash;
    for (;;) {
        idx = copy.indexOf('~', idx);
        if (idx == -1)
            return copy;
        slash = copy.indexOf('/', idx + 1);
        if (slash == -1)
            slash = copy.size();
        copy.replace(idx, slash - idx, homeDirectory(copy.mid(idx + 1, slash - idx - 1)));
        idx += slash - idx;
    }
    return copy;
}

Path findFile(const String& path, const String filename)
{
    const List<String> candidates = path.split(':');
    for (const String& cand : candidates) {
        Path pcand = homeify(path + "/" + filename);
        if (pcand.exists())
            return pcand;
    }
    return Path();
}

static iconv_t iconvToUtf8;
static iconv_t iconvFromUtf8;
static std::once_flag iconvToUtf8Flag;
static std::once_flag iconvFromUtf8Flag;

String wcharToUtf8(const wchar_t* string, ssize_t size)
{
    std::call_once(iconvToUtf8Flag, []() { iconvToUtf8 = iconv_open("UTF-8", "WCHAR_T"); });
    if (iconvToUtf8 == reinterpret_cast<iconv_t>(-1))
        return String();
    size_t sz;
    if (size == -1)
        sz = static_cast<ssize_t>(wcslen(string));
    else
        sz = static_cast<size_t>(size);

    size_t max = sz * 4; // An UTF-8 sequence is at most 4 bytes
    sz *= sizeof(wchar_t);
    String out(max, '\0');
    char* outdata = out.data();
    char* indata = reinterpret_cast<char*>(const_cast<wchar_t*>(string));
    const size_t ret = iconv(iconvToUtf8, &indata, &sz, &outdata, &max);
    // reset the iconv state
    iconv(iconvToUtf8, NULL, NULL, NULL, NULL);
    if (ret == static_cast<size_t>(-1))
        return String();
    out.resize(out.size() - max);
    return out;
}

String wcharToUtf8(const std::wstring& string)
{
    return wcharToUtf8(string.c_str(), string.size());
}

std::wstring utf8ToWChar(const char* string, ssize_t size)
{
    std::call_once(iconvFromUtf8Flag, []() { iconvFromUtf8 = iconv_open("WCHAR_T", "UTF-8"); });
    size_t sz;
    if (size == -1)
        sz = static_cast<ssize_t>(strlen(string));
    else
        sz = static_cast<size_t>(size);
    size_t max = sz * sizeof(wchar_t); // A multibyte sequence might be exactly the same amount of characters as an UTF-8 sequence
    std::wstring out(sz, L'\0');
    char* outdata = reinterpret_cast<char*>(&out[0]);
    char* indata = const_cast<char*>(string);
    const size_t ret = iconv(iconvFromUtf8, &indata, &sz, &outdata, &max);
    // reset the iconv state
    iconv(iconvFromUtf8, NULL, NULL, NULL, NULL);
    if (ret == static_cast<size_t>(-1))
        return std::wstring();
    out.resize(out.size() - (max / sizeof(wchar_t)));
    return out;
}

std::wstring utf8ToWChar(const String& data)
{
    return utf8ToWChar(data.constData(), data.size());
}

}
