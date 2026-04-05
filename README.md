# streamingjson

Streaming JSON parser that yields partial values as chunks arrive.

- `parseJson` takes any `AsyncIterable<string>` and yields partial snapshots at each chunk boundary.
- `zStreaming` wraps a Zod schema so it accepts those partials.

## Example Usage

```ts
import { parseJson } from "@foodelevator/streamingjson";

const res = await fetch("https://api.example.com/user/1");
const json = res.body!.pipeThrough(new TextDecoderStream());

for await (const partial of parseJson(json)) {
    console.log(partial);
    // { name: "Ali" }
    // { name: "Alice" }
    // { name: "Alice", age: 3 }
    // { name: "Alice", age: 34 }
    // { name: "Alice", age: 34, tags: ["ty"] }
    // { name: "Alice", age: 34, tags: ["typescript", "z"] }
    // ...
}
```

```ts
import { zStreaming } from "@foodelevator/streamingjson";
import * as z from "zod";

const someSchema = z.object({
  a: z.number(),
  b: z.enum(["hello", "there"]),
  tags: z.array(z.string()),
});
const streamingSchema = zStreaming(someSchema);
type StreamingThing = z.infer<typeof streamingSchema>;
// type StreamingThing = {
//     a?: number | undefined;
//     b?: string | undefined;
//     tags?: string[] | undefined;
// }
```
