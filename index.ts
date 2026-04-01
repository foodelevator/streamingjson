export class JsonParsingError extends Error {
}

export function parseJson(s: string): unknown {
    s = skipWs(s);
    const [value, rest] = parse(s);
    if (skipWs(rest) !== "") throw new JsonParsingError();
    return value;
}

function skipWs(s: string): string {
    let i = 0;
    while (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r") i++;
    return i === 0 ? s : s.slice(i);
}

function parse(s: string): [unknown, string] {
    switch (s[0]) {
        case "n":
            return parseLiteral(s, "null", null);
        case "t":
            return parseLiteral(s, "true", true);
        case "f":
            return parseLiteral(s, "false", false);
        case "[":
            return parseArray(s);
        case '"':
            return parseString(s);
        case '{':
            return parseObject(s);
        default:
            if (s[0] && "0" <= s[0] && s[0] <= "9" || s[0] == "-")
                return parseNumber(s);
            else
                throw new JsonParsingError();
    }
}

function parseLiteral(s: string, literal: string, value: unknown): [unknown, string] {
    if (s.startsWith(literal)) {
        return [value, s.slice(literal.length)];
    } else {
        throw new JsonParsingError();
    }
}

function parseArray(s: string): [unknown[], string] {
    if (s[0] != "[") throw new JsonParsingError();

    var result = [];
    while (true) {
        s = skipWs(s.slice(1));
        if (result.length == 0 && s[0] == "]") return [result, s.slice(1)];

        const [value, rest] = parse(s);
        result.push(value);
        s = skipWs(rest);

        if (s[0] == "]") return [result, s.slice(1)];
        if (s[0] != ",") throw new JsonParsingError();
    }
}

function hexDigit(c: string): number {
    if ("0" <= c && c <= "9") return c.charCodeAt(0) - 48;
    if ("a" <= c && c <= "f") return c.charCodeAt(0) - 87;
    if ("A" <= c && c <= "F") return c.charCodeAt(0) - 55;
    throw new JsonParsingError();
}

function parseHex4(s: string, offset: number): number {
    return (hexDigit(s[offset]!) << 12) | (hexDigit(s[offset + 1]!) << 8) | (hexDigit(s[offset + 2]!) << 4) | hexDigit(s[offset + 3]!);
}

const basicEscapes = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
};
function parseString(s: string): [string, string] {
    if (s[0] != '"') throw new JsonParsingError();
    s = s.slice(1);

    let result = "";
    let start = 0;
    while (true) {
        let i = start;
        while (s[i] && s[i] != "\\" && s[i] != '"' && s.charCodeAt(i) >= 0x20) i++;
        result += s.slice(start, i);
        if (i >= s.length) throw new JsonParsingError();
        if (s[i] == '"') return [result, s.slice(i + 1)];
        if (s[i] != "\\")
            // Raw control character. Must be escaped.
            throw new JsonParsingError();
        if (s[i + 1]! in basicEscapes) {
            result += basicEscapes[s[i + 1] as keyof typeof basicEscapes];
            start = i + 2;
        } else if (s[i + 1] == "u") {
            if (i + 6 > s.length) throw new JsonParsingError();
            const hex = parseHex4(s, i + 2);
            const codePoint = hex;
            // Handle surrogate pairs
            if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
                if (s[i + 6] == "\\" && s[i + 7] == "u" && i + 12 <= s.length) {
                    const lowSurrogate = parseHex4(s, i + 8);
                    if (lowSurrogate >= 0xDC00 && lowSurrogate <= 0xDFFF) {
                        result += String.fromCodePoint(0x10000 + ((codePoint - 0xD800) << 10) + (lowSurrogate - 0xDC00));
                        start = i + 12;
                    } else {
                        result += String.fromCharCode(codePoint);
                        start = i + 6;
                    }
                } else {
                    result += String.fromCharCode(codePoint);
                    start = i + 6;
                }
            } else {
                result += String.fromCharCode(codePoint);
                start = i + 6;
            }
        } else {
            throw new JsonParsingError();
        }
    }
}

function parseObject(s: string): [Record<string, unknown>, string] {
    if (s[0] != "{") throw new JsonParsingError();
    s = s.slice(1);

    const object: Record<string, unknown> = {};
    let foundEntry = false;
    s = skipWs(s);

    while (true) {
        if (!foundEntry && s[0] == "}") return [object, s.slice(1)];

        const [key, rest] = parseString(s);
        s = skipWs(rest);

        if (s[0] != ":") throw new JsonParsingError();
        s = skipWs(s.slice(1));

        const [value, rest2] = parse(s);
        s = skipWs(rest2);

        Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });

        if (s[0] == "}") return [object, s.slice(1)];
        if (s[0] != ",") throw new JsonParsingError();
        s = skipWs(s.slice(1));
        foundEntry = true;
    }
}

function parseNumber(s: string): [number, string] {
    let i = 0;
    if (s[i] == "-") {
        i++;
    }
    let foundDigit = false;
    while (s[i] && "0" <= s[i]! && s[i]! <= "9") {
        i++;
        foundDigit = true;
    }
    if (!foundDigit) throw new JsonParsingError();
    // Disallow leading zeros for non-zero numbers
    const intStart = s[0] == "-" ? 1 : 0;
    if (i - intStart > 1 && s[intStart] == "0") throw new JsonParsingError();
    if (s[i] == ".") {
        i++;

        let foundDigit = false;
        while (s[i] && "0" <= s[i]! && s[i]! <= "9") {
            i++;
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }
    if (s[i] == "e" || s[i] == "E") {
        i++;
        if (s[i] == "-" || s[i] == "+") {
            i++;
        }
        let foundDigit = false;
        while (s[i] && "0" <= s[i]! && s[i]! <= "9") {
            i++;
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    const [result, rest] = [s.slice(0, i), s.slice(i)];
    return [Number(result), rest];
}
