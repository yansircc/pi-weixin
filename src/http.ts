import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { HttpRequestError } from "./errors.ts";

export interface JsonHttpRequest {
  readonly operation: string;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeout?: `${number} millis` | `${number} seconds`;
}

export interface JsonHttpClient {
  readonly request: (request: JsonHttpRequest) => Effect.Effect<unknown, HttpRequestError>;
}

export const makeJsonHttpClient = (client: HttpClient.HttpClient): JsonHttpClient => ({
  request: (input) => {
    const request =
      input.method === "GET"
        ? Effect.succeed(HttpClientRequest.get(input.url))
        : HttpClientRequest.post(input.url).pipe(HttpClientRequest.bodyJson(input.body ?? {}));
    const execute = request.pipe(
      Effect.map((value) =>
        input.headers ? HttpClientRequest.setHeaders(value, input.headers) : value,
      ),
      Effect.flatMap(client.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
      Effect.mapError(
        (cause) =>
          new HttpRequestError({
            operation: input.operation,
            url: input.url,
            cause,
          }),
      ),
    );
    return input.timeout
      ? execute.pipe(
          Effect.timeoutOrElse({
            duration: input.timeout,
            orElse: () =>
              Effect.fail(
                new HttpRequestError({
                  operation: input.operation,
                  url: input.url,
                  cause: "timeout",
                }),
              ),
          }),
        )
      : execute;
  },
});
