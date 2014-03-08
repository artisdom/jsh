#ifndef INPUT_H
#define INPUT_H

#include "Shell.h"
#include <rct/Thread.h>

struct editline;
typedef struct editline EditLine;

class Input : public Thread
{
public:
    Input(Shell* shell, int argc, char** argv)
        : mShell(shell), mArgc(argc), mArgv(argv)
    {
    }

private:
    enum TokenizeFlag {
        Tokenize_None = 0x0,
        Tokenize_CollapseWhitespace = 0x1,
        Tokenize_ExpandEnvironmentVariables = 0x2
    };
    List<Shell::Token> tokenize(String line, unsigned int flags, String &error) const;
    bool expandEnvironment(String &string, String &err) const;
    void process(const List<Shell::Token> &tokens);
    void runCommand(const String& command, const List<String>& arguments);
    int getChar(EditLine *el, wchar_t *ch);
    String env(const String &var) const { return mEnviron.value(var); }
    enum CompletionResult {
        Completion_Refresh,
        Completion_Redisplay,
        Completion_Error
    };
    CompletionResult complete(const String &line, int cursor, String &insert);

    static void addPrev(List<Shell::Token> &tokens, const char *&last, const char *str, unsigned int flags);
    static void addArg(List<Shell::Token> &tokens, const char *&last, const char *str, unsigned int flags);
    static unsigned char elComplete(EditLine *el, int);

protected:
    virtual void run();

private:
    Shell* mShell;
    int mArgc;
    char** mArgv;
    Hash<String, String> mEnviron;
    String mBuffer;
};

#endif
