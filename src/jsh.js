var rl = require('ReadLine');
var pc = require('ProcessChain');
var Job = require('Job');
var Tokenizer = require('Tokenizer');
var jsh = require('jsh');
var path = require('path');
var fs = require('fs');
global.jsh = {
    jshNative: new jsh.native.jsh(),
    Job: Job,
    jobCount: 0
};
var read;
var runState;

function RunState()
{
    this._data = [];
}

RunState.prototype.push = function(cb)
{
    this._data.push({cb: cb, status: []});
};

RunState.prototype.pop = function()
{
    var data = this._data.pop();
    var c = this._calc(data.status);
    console.log("popping with " + JSON.stringify(c));
    data.cb(c.status);
};

RunState.prototype.at = function(pos)
{
    if (pos < 0 || pos >= this._data.length)
        return undefined;
    return this._data[pos];
};

RunState.prototype.update = function(status)
{
    this._data[this._data.length - 1].status = [status];
};

RunState.prototype.checkOperator = function(op, ret)
{
    var cur = this._data[this._data.length - 1];
    if (op === "&&" || op === "||" || op === ";") {
        switch (this._currentOp()) {
        case ";":
        case "|":
            cur.status = [];
            break;
        }
        cur.status.push(ret, op);
        return this._calc(cur.status).cont;
    }
    return false;
};

RunState.prototype._currentOp = function()
{
    if (this._data.length === 0)
        return "";
    var cur = this._data[this._data.length - 1];
    if (cur.status.length < 2)
        return "";
    var pos = cur.status.length - 1;
    if (!(pos % 2))
        return "";
    return cur.status[pos];
};

RunState.prototype._calc = function(status)
{
    if (status.length === 0)
        return { cont: true, status: true };
    var cur = undefined;
    var op = undefined;
    for (var idx = 0; idx < status.length; ++idx) {
        if (cur === undefined) {
            cur = status[idx];
            continue;
        }
        if (idx % 2) {
            op = status[idx];
            var next = (idx + 1 < status.length) ? status[idx + 1] : undefined;

            switch (op) {
            case "&&":
                if (!cur)
                    return { cont: false, status: false };
                if (next !== undefined) {
                    cur = next;
                }
                break;
            case "||":
                if (cur)
                    return { cont: false, status: true };
                if (next !== undefined) {
                    cur = next;
                }
                break;
            case ";":
                return { cont: true, status: cur };
            }
        }
    }
    return { cont: true, status: (cur === undefined) ? true : cur };
};

function isFunction(token)
{
    if (token[0].type === Tokenizer.COMMAND) {
        // Check if the first token is an existing function

        var list = token[0].data.split('.');
        var obj = global;
        for (var i in list) {
            if (obj === undefined)
                return false;
            console.log("testing " + list[i]);
            obj = obj[list[i]];
        }
        return (typeof obj === "function");
    }
    return false;
}

function maybeJavaScript(token)
{
    if (token[0].type === Tokenizer.GROUP) {
        return false;
    } else if (token[0].type === Tokenizer.JAVASCRIPT) {
        if (token.length !== 1) {
            throw "Unexpected JS token length: " + token.length;
        }
        return true;
    } else if (isFunction(token)) {
        return true;
    }
    return false;
}

function runJavaScript(token, job)
{
    var func = "";
    var state = 0;
    var cnt = 0, i;

    if (token.length < 1) {
        throw "Token length < 1 - " + token.length;
    }
    var end = token.length;
    if (token[token.length - 1].type === Tokenizer.OPERATOR) {
        end = token.length - 1;
    }

    if (token[0].type !== Tokenizer.JAVASCRIPT) {
        for (i = 0; i < end; ++i) {
            if (!func) {
                func = token[i].data + "(";
            } else {
                if (token[i].type === Tokenizer.GROUP) {
                    func += token[i].data;
                } else {
                    if (token[i].data === "'") {
                        if (state === 0) {
                            if (cnt)
                                func += ", ";
                            func += "'";
                            state = 1;
                        } else {
                            func += "'";
                            state = 0;
                        }
                    } else {
                        if (state === 0 && cnt)
                            func += ", ";
                        func += token[i].data;
                    }
                    ++cnt;
                }
            }
        }
        func += ")";
    } else {
        for (i in token) {
            func += token[i].data + " ";
        }
    }

    if (job) {
        var jobfunc = undefined;
        try {
            jobfunc = eval("(function(data) {" + func + "})");
        } catch (e) {
        }
        if (typeof jobfunc === "function") {
            job.js(new Job.JavaScript(jobfunc));
        }
        return undefined;
    } else {
        console.log("evaling " + func);
        return eval.call(global, func);
    }
}

function operator(token)
{
    if (token.length === 0)
        return undefined;
    var tok = token[token.length - 1];
    if (tok.type === Tokenizer.OPERATOR)
        return tok.data;
    else if (tok.type === Tokenizer.HIDDEN && tok.data === ";")
        return tok.data;
    return undefined;
}

function hasWait(obj)
{
    if (typeof obj === "object")
        if (typeof obj.jsh === "object")
            return obj.jsh.wait;
    return false;
}

function jsReturn(ret)
{
    if (typeof ret === "boolean")
        return ret;
    if (typeof ret === "object")
        if (typeof ret.jsh === "object")
            return ret.jsh.ret;
    return !!ret;
}

function runTokens(tokens, pos)
{
    if (pos === tokens.length) {
        runState.pop();
        return;
    }

    var job;
    for (var i = pos; i < tokens.length; ++i) {
        var token = tokens[i];
        var op = operator(token);
        console.log("----");
        op = operator(token);
        if (op === undefined) {
            throw "Unrecognized operator";
        }
        // remove the operator
        token.pop();

        console.log("operator " + op);
        if (op === '|') {
            if (!job) {
                job = new Job.Job();
            }
        } else if (op !== ';' && job) {
            throw "Invalid operator for pipe job";
        }
        for (i in token) {
            console.log("  token " + token[i].type + " '" + token[i].data + "'");
        }

        var iscmd = true, ret;
        if (token.length >= 1 && token[0].type === Tokenizer.GROUP) {
            console.log("    is a group");
            // run the group
            runState.push(function(ret) {
                if (runState.checkOperator(op, ret))
                    runTokens(tokens, pos + 1);
                else
                    runState.pop();
            });
            runLine(token[0].data);
            return;
        } else if (maybeJavaScript(token)) {
            console.log("    might be js");
            iscmd = false;
            try {
                ret = runJavaScript(token, job);
            } catch (e) {
                ret = false;
                console.error(e);
            }
        }
        if (!iscmd) {
            if (hasWait(ret)) {
                console.log("pushing...");
                runState.push(function(ret) {
                    console.log("done!");
                    if (runState.checkOperator(op, ret))
                        runTokens(tokens, pos + 1);
                    else
                        runState.pop();
                });
                return;
            }
            if (runState.checkOperator(op, jsReturn(ret))) {
                continue;
            } else {
                runState.pop();
                return;
            }
        }
        console.log("  is a command");
        var cmd = undefined;
        var args = [];
        for (i in token) {
            if (cmd === undefined) {
                cmd = token[i].data;
            } else if (token[i].type !== Tokenizer.HIDDEN) {
                args.push(token[i].data);
            }
        }
        if (cmd !== undefined) {
            console.log("execing cmd " + cmd);
            try {
                if (job) {
                    job.proc({ program: cmd, arguments: args, environment: global.jsh.environment(), cwd: process.cwd() });
                } else {
                    var procjob = new Job.Job();
                    procjob.proc({ program: cmd, arguments: args, environment: global.jsh.environment(), cwd: process.cwd() });
                    procjob.exec(Job.FOREGROUND, function(data) { console.log(data); },
                                 function(code) {
                                     if (runState.checkOperator(op, !code)) {
                                         try {
                                             runTokens(tokens, pos + 1, runState);
                                         } catch (e) {
                                             console.log(e);
                                             runState.pop();
                                         }
                                     } else {
                                         runState.pop();
                                     }
                                 });
                    return;
                }
            } catch (e) {
                console.log(e);
                throw e;
            }
        }
    }
    if (job) {
        console.log("running job");
        job.exec(Job.FOREGROUND, console.log, function(code) { runState.update(!code); runState.pop(); });
    }
}

function runLine(line)
{
    var tokens = [];
    var tok = new Tokenizer.Tokenizer(), token;
    tok.tokenize(line);
    var isjs = true;
    while ((token = tok.next())) {
        // for (var idx = 0; idx < token.length; ++idx) {
        //     console.log(token[idx].type + " -> " + token[idx].data);
        // }
        tokens.push(token);
    }
    var ret;
    if (tokens.length === 1 && isFunction(tokens[0])) {
        try {
            ret = runJavaScript(tokens[0]);
        } catch (e) {
            console.log(e);
            isjs = false;
        }
    } else {
        try {
            console.log("trying the entire thing: '" + line + "'");
            ret = eval.call(global, line);
        } catch (e) {
            console.log(e);
            isjs = false;
        }
    }
    if (isjs) {
        console.log("is js, ret " + JSON.stringify(ret));
        if (hasWait(ret)) {
            console.log("has wait foo");
            return;
        }
        runState.update(jsReturn(ret));
        runState.pop();
        return;
    }

    try {
        runTokens(tokens, 0);
    } catch (e) {
        console.log(e);
        runState.pop();
    }
}

function setupEnv() {
    for (var i in process.env) {
        if (i !== undefined)
            global[i] = process.env[i];
    }
}

function setupBuiltins() {
    var builtins = require('Builtins');
    for (var i in builtins) {
        global[i] = builtins[i];
    }
}

global.jsh.environment = function() {
    var env = [];
    for (var i in global) {
        if (typeof global[i] === "string"
            || typeof global[i] === "number") {
            env.push(i + "=" + global[i]);
        }
    }
    return env;
};

setupEnv();
setupBuiltins();
runState = new RunState();

read = new rl.ReadLine(function(data) {
    if (data === undefined) {
        read.cleanup();
        global.jsh.jshNative.cleanup();
        process.exit();
    }

    try {
        runState.push(function() { read.resume(); });
        runLine(data, runState);
    } catch (e) {
        console.log(e);
        read.resume();
    }
});
