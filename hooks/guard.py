"""Static inspection for Brigade git hygiene; shell code is never evaluated."""
import json
import os
import re
import shlex
import sys
class GuardError(Exception): pass
SUBSTITUTION = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
SEPARATORS = set(";&|()\n")
SHELLS = {"bash", "dash", "ksh", "sh", "zsh"}
GIT_VALUE = {"-C", "-c", "--config-env", "--exec-path", "--git-dir", "--namespace", "--super-prefix", "--work-tree"}
COMMIT_VALUE = {"--author", "--cleanup", "--date", "--file", "--fixup", "--gpg-sign", "--message",
                "--reedit-message", "--reuse-message", "--squash", "--template", "--trailer"}
def uncomment(source):
    lexer = shlex.shlex(re.sub(r"(?<![\s;&|()<>])#", "\ue000", source), posix=False)
    lexer.commenters, lexer.whitespace_split = "#", True
    return " ".join(lexer).replace("\ue000", "#")
def substitutions(source, single_quotes_are_data=True, comments_are_data=False):
    if not comments_are_data: source = uncomment(source)
    active = " ".join(re.split(r"'[^']*'", source)[::2]) if single_quotes_are_data else source
    matches = list(SUBSTITUTION.finditer(active))
    residue = SUBSTITUTION.sub("", active)
    if "$(" in residue or "`" in residue: raise GuardError("ambiguous command substitution")
    for match in matches:
        yield match.group(1) if match.group(1) is not None else match.group(2)
def heredocs(line):
    if "<<" not in line: return
    lexer = shlex.shlex(line, posix=False, punctuation_chars="<")
    lexer.commenters, lexer.whitespace_split = "#", True
    try:
        tokens = list(lexer)
    except ValueError:
        yield from _scan_heredocs(line)
        return
    positions, cursor = [], 0
    for token in tokens:
        start = line.index(token, cursor)
        positions.append(start)
        cursor = start + len(token)
    for index, (token, raw) in enumerate(zip(tokens, tokens[1:])):
        if token == "<<":
            strip_tabs, delimiter_raw = raw.startswith("-"), raw.lstrip("-")
            quoted = len(delimiter_raw) > 1 and delimiter_raw[0] == delimiter_raw[-1] and delimiter_raw[0] in "'\""
            span = (positions[index], positions[index + 1] + len(raw))
            yield (delimiter_raw[1:-1] if quoted else delimiter_raw), strip_tabs, quoted, span
def _skip_arithmetic(line, i):
    # $(( ... )) is arithmetic, not a command substitution: read it verbatim (a << in
    # here is a bit-shift, not a heredoc) and stop once the matching )) is found.
    n, i, depth = len(line), i + 3, 2
    while i < n and depth > 0:
        depth += 1 if line[i] == "(" else -1 if line[i] == ")" else 0
        i += 1
    if depth > 0: raise GuardError("unbalanced quoting around a heredoc")
    return i
def _advance_quote_state(line, i, stack):
    # One step of quote/substitution-frame bookkeeping (rules 1-2), shared by the
    # heredoc recovery scanner and the plain frame-depth check below: single/double
    # quotes toggle (fresh per substitution frame), backslash escapes outside single
    # quotes, $(( skips to its matching )) verbatim, and $( pushes a fresh frame that
    # a following ) pops. No heredoc-specific logic lives here.
    frame = stack[-1]
    quote = frame["quote"]
    char = line[i]
    if char == "\\" and quote != "'":
        return i + 2
    if quote == "'":
        if char == "'": frame["quote"] = None
        return i + 1
    if quote == '"':
        if char == '"':
            frame["quote"] = None
            return i + 1
        if line[i:i + 3] == "$((": return _skip_arithmetic(line, i)
        if line[i:i + 2] == "$(":
            stack.append({"quote": None})
            return i + 2
        return i + 1
    # quote is None here: OUTSIDE, whether at top level or inside a clean frame.
    if char == "'":
        frame["quote"] = "'"
        return i + 1
    if char == '"':
        frame["quote"] = '"'
        return i + 1
    if line[i:i + 3] == "$((": return _skip_arithmetic(line, i)
    if line[i:i + 2] == "$(":
        stack.append({"quote": None})
        return i + 2
    if char == ")" and len(stack) > 1:
        stack.pop()
        return i + 1
    return i + 1
def _frame_depth(line, limit):
    # How many $(...) substitution frames are still open just before `limit` in the
    # line. Used to decide whether a heredoc operator sits inside a live substitution
    # (rule 8) -- an ordinary top-level heredoc is left untouched so anything hiding in
    # its own delimiter (like a nested $(...)) still reaches substitutions()/inspect().
    stack, i = [{"quote": None}], 0
    while i < limit:
        i = _advance_quote_state(line, i, stack)
    return len(stack) - 1
def _scan_heredocs(line):
    # Recovery path for lines shlex refuses to tokenize: a line whose only "unbalanced"
    # quote is one opened by a double-quoted command substitution is still a real,
    # parseable heredoc (the substitution content is live shell, closed on a later
    # line) — walk it by hand instead of giving up. Every state this can't resolve on
    # the spot raises GuardError; nothing is guessed at.
    results, n, i = [], len(line), 0
    stack = [{"quote": None}]
    while i < n:
        frame = stack[-1]
        if frame["quote"] is not None:
            i = _advance_quote_state(line, i, stack)
            continue
        # quote is None here: OUTSIDE, whether at top level or inside a clean frame.
        if line[i:i + 3] == "<<<":
            i += 3
        elif line[i:i + 2] == "<<":
            operator_start = i
            i += 2
            strip_tabs = False
            if i < n and line[i] == "-":
                strip_tabs, i = True, i + 1
            while i < n and line[i] in " \t":
                i += 1
            if i < n and line[i] in "'\"":
                delim_quote, start = line[i], i
                i += 1
                while i < n and line[i] != delim_quote:
                    i += 1
                if i >= n: raise GuardError("unbalanced quoting around a heredoc")
                i += 1
                delimiter, quoted = line[start + 1:i - 1], True
            else:
                start = i
                while i < n and not line[i].isspace() and line[i] not in ";&|()<>":
                    i += 1
                delimiter, quoted = line[start:i], False
                if not delimiter: raise GuardError("unbalanced quoting around a heredoc")
            results.append((delimiter, strip_tabs, quoted, (operator_start, i)))
        else:
            i = _advance_quote_state(line, i, stack)
    if len(stack) == 1 and stack[0]["quote"] is not None:
        raise GuardError("unbalanced quoting around a heredoc")
    return results
def _mask_spans(line, spans):
    for start, end in sorted(spans, reverse=True):
        line = line[:start] + " " + line[end:]
    return line
def strip_heredocs(source):
    pending, code, nested = [], [], []
    for line in source.splitlines(keepends=True):
        if pending:
            delimiter, strip_tabs, quoted = pending[0]
            candidate = line.rstrip("\r\n")
            candidate = candidate.lstrip("\t") if strip_tabs else candidate
            if candidate == delimiter:
                pending.pop(0)
            elif not quoted:
                nested.extend(substitutions(line, False, True))
            code.append("\n")
            continue
        found = list(heredocs(line))
        mask = [span for *_, span in found if _frame_depth(line, span[0]) > 0]
        code.append(_mask_spans(line, mask))
        pending.extend((delimiter, strip_tabs, quoted) for delimiter, strip_tabs, quoted, span in found)
    if pending: raise GuardError("unterminated heredoc")
    return "".join(code), nested
def segments(source):
    lexer = shlex.shlex(source, posix=True, punctuation_chars=";&|()\n")
    lexer.commenters, lexer.whitespace, lexer.whitespace_split = "#", " \t\r", True
    segment = []
    try:
        for token in lexer:
            if token and set(token) <= SEPARATORS:
                if segment:
                    yield segment
                    segment = []
            else:
                segment.append(token)
    except ValueError as error:
        raise GuardError(str(error)) from error
    if segment: yield segment
def unwrap(tokens):
    tokens, index = list(tokens), 0
    while index < len(tokens) and ASSIGNMENT.match(tokens[index]):
        index += 1
    while index < len(tokens):
        name = os.path.basename(tokens[index])
        if name == "command":
            index += 1
            if index < len(tokens) and tokens[index] in {"-v", "-V"}: return tokens, None
            while index < len(tokens) and tokens[index] in {"-p", "--"}:
                index += 1
        elif name == "env":
            env_index, index = index, index + 1
            while index < len(tokens):
                token = tokens[index]
                if ASSIGNMENT.match(token) or token in {"-i", "--ignore-environment", "--"}:
                    index += 1
                elif token in {"-S", "--split-string"}:
                    if index + 1 >= len(tokens): raise GuardError("env split-string missing value")
                    tokens[index:index + 2] = shlex.split(tokens[index + 1])
                    index = env_index
                    break
                elif token.startswith("--split-string="):
                    tokens[index:index + 1] = shlex.split(token.split("=", 1)[1])
                    index = env_index
                    break
                elif token.startswith("-S") and token != "-S":
                    tokens[index:index + 1] = shlex.split(token[2:])
                    index = env_index
                    break
                elif token in {"-C", "-u", "--chdir", "--unset"}:
                    index += 2
                elif token.startswith("-"):
                    index += 1
                else:
                    break
        elif name == "exec":
            index += 1
            while index < len(tokens):
                token = tokens[index]
                if token in {"-a", "--argv0"}:
                    index += 2
                elif token == "--":
                    index += 1
                    break
                elif token.startswith("--argv0=") or token.startswith("-"):
                    index += 1
                else:
                    break
        else:
            return tokens, index
    return tokens, None
def shell_payload(tokens, index):
    index += 1
    while index < len(tokens):
        option = tokens[index]
        if option == "--" or not option.startswith("-") or option == "-": return None
        if not option.startswith("--") and "c" in option[1:]:
            if index + 1 >= len(tokens): raise GuardError("shell -c missing command")
            return tokens[index + 1]
        index += 2 if option in {"-O", "-o", "--init-file", "--rcfile"} else 1
    return None
def broad_path(path):
    pattern = path
    if path.startswith(":(") and ")" in path:
        magic, pattern = path[2:].split(")", 1)
        if "exclude" in magic.split(","): return True
    elif path.startswith((":!", ":^")):
        return True
    elif path.startswith(":/"):
        pattern = path[2:]
    return os.path.normpath(pattern) == "." or any(char in pattern for char in "*?[")
def brigade_path(path):
    if path.startswith(":(") and ")" in path:
        path = path.split(")", 1)[1]
    elif path.startswith(":/"):
        path = path[2:]
    return ".brigade" in os.path.normpath(path).split(os.sep)
def path_violation(paths, verb):
    for path in paths:
        if broad_path(path): return "no repository-wide or wildcard pathspec"
        if brigade_path(path): return f".brigade/ cannot be {verb}"
    return None
def add_violation(arguments):
    paths, update, options = [], False, True
    for token in arguments:
        if options and token == "--":
            options = False
        elif options and token == "--update":
            update = True
        elif options and token in {"--all", "--force"}:
            return "no indiscriminate staging"
        elif options and token.startswith("--pathspec-from-file"):
            return "no pathspec-file staging"
        elif options and token.startswith("-") and token != "-":
            if any(flag in token[1:] for flag in "Af"): return "no indiscriminate staging"
            update = update or "u" in token[1:]
        else:
            paths.append(token)
    return "no repository-wide update staging" if update and not paths else path_violation(paths, "staged")
def commit_violation(arguments):
    paths, options, index = [], True, 0
    while index < len(arguments):
        token = arguments[index]
        if options and token == "--":
            options = False
        elif options and token == "--all":
            return "no commit -a/--all"
        elif options and token.startswith("--pathspec-from-file"):
            return "no pathspec-file commit"
        elif options and token.startswith("-") and not token.startswith("--"):
            flags = token[1:]
            value_at = min((flags.find(flag) for flag in "mFCctS" if flag in flags), default=len(flags))
            if "a" in flags[:value_at]: return "no commit -a/--all"
            index += int(value_at == len(flags) - 1 and flags[value_at] != "S")
        elif options and token.startswith("-"):
            option = token.split("=", 1)[0]
            index += int(option in COMMIT_VALUE and "=" not in token)
        else:
            paths.append(token)
        index += 1
    return path_violation(paths, "committed")
def git_command(tokens, index):
    index += 1
    while index < len(tokens):
        token, option = tokens[index], tokens[index].split("=", 1)[0]
        if token == "--":
            index += 1
            break
        if option in GIT_VALUE:
            index += 1 if "=" in token else 2
        elif token.startswith("-"):
            index += 1
        else:
            break
    return None if index >= len(tokens) else (tokens[index], tokens[index + 1:])
def inspect(source, depth=0):
    if depth > 8: raise GuardError("nested inspection limit exceeded")
    code, heredoc_nested = strip_heredocs(source)
    for nested in [*heredoc_nested, *substitutions(code)]:
        violation = inspect(nested, depth + 1)
        if violation:
            return violation
    for original in segments(code):
        tokens, index = unwrap(original)
        if index is None:
            continue
        name = os.path.basename(tokens[index])
        if name in SHELLS:
            payload = shell_payload(tokens, index)
            violation = inspect(payload, depth + 1) if payload is not None else None
        elif name == "eval":
            payload = " ".join(tokens[index + 1:])
            if not payload or "$" in payload or "`" in payload:
                raise GuardError("dynamic eval is unsupported")
            violation = inspect(payload, depth + 1)
        elif name == "git":
            command = git_command(tokens, index)
            if command is None:
                continue
            subcommand, arguments = command
            violation = (add_violation(arguments) if subcommand == "add" else
                         commit_violation(arguments) if subcommand == "commit" else None)
        else:
            violation = None
        if violation:
            return violation
    return None
def main():
    try:
        command = json.load(sys.stdin)["tool_input"]["command"]
        if not isinstance(command, str): raise TypeError
    except (KeyError, TypeError, ValueError):
        print("invalid hook payload; refusing command"); return
    try:
        violation = inspect(command)
    except GuardError as error:
        print(f"could not safely inspect command: {error}"); return
    except Exception:
        print("could not safely inspect command: internal inspection error"); return
    if violation: print(violation)
if __name__ == "__main__":
    main()
