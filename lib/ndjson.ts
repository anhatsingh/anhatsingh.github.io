/*
  Reads a newline-delimited JSON stream.

  The whole reason NDJSON was chosen over SSE: a chunk boundary can land
  anywhere, including the middle of an object, so the buffer here holds the
  partial line until its newline arrives. Getting this wrong produces a parse
  error under load and never in development, where responses arrive in one
  piece.
*/
export async function* readNdjson<T>(response: Response): AsyncGenerator<T> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // stream: true, so a multi-byte character split across chunks survives.
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // The last piece has no newline yet — it may be half an object.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as T;
      }
    }

    // A final line with no trailing newline still counts.
    if (buffer.trim()) yield JSON.parse(buffer) as T;
  } finally {
    reader.releaseLock();
  }
}
