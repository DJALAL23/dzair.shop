/**
 * R2's S3 API for tests: every request's SigV4 signature is checked by
 * signing it again with the bucket's keys at the same time, so a request
 * signed for another key, type or size is refused; a presigned URL past its
 * expiry is refused. Requests can be made to fail.
 */
import { AwsClient } from "aws4fetch";
import type { R2S3Access } from "../r2";

export interface FakeS3 {
  fetch: (request: Request) => Promise<Response>;
  endpoint: string;
  objects: Map<string, { body: Uint8Array; contentType: string }>;
  failNext(times: number, status: number): void;
  /** Move the fake's clock, as a request arriving later. */
  advance(ms: number): void;
}

const QUERY_SIGNATURE = ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-SignedHeaders", "X-Amz-Signature"];

const toDate = (amzDate: string) => new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);

/** `endpoint` is where it answers: the account's own address when a test reaches R2 as production does. */
export function fakeS3(access: R2S3Access, options: { endpoint?: string } = {}): FakeS3 {
  const endpoint = options.endpoint ?? "https://r2.s3.test";
  const client = new AwsClient({ accessKeyId: access.accessKeyId, secretAccessKey: access.secretAccessKey, service: "s3", region: "auto" });
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  let failures = { times: 0, status: 0 };
  let skew = 0;

  async function signedRightly(request: Request, body: Uint8Array): Promise<boolean> {
    const url = new URL(request.url);
    const querySignature = url.searchParams.get("X-Amz-Signature");
    if (querySignature !== null) {
      const amzDate = url.searchParams.get("X-Amz-Date") ?? "";
      const expires = Number(url.searchParams.get("X-Amz-Expires") ?? 0);
      if (toDate(amzDate).getTime() + expires * 1000 < Date.now() + skew) return false;
      const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";").filter((name) => name !== "host");
      const headers: Record<string, string> = {};
      for (const name of signedHeaders) headers[name] = name === "content-length" ? String(body.byteLength) : (request.headers.get(name) ?? "");
      const unsigned = new URL(url);
      for (const name of QUERY_SIGNATURE) unsigned.searchParams.delete(name);
      const again = await client.sign(unsigned.toString(), { method: request.method, headers, aws: { signQuery: true, allHeaders: true, datetime: amzDate } });
      return new URL(again.url).searchParams.get("X-Amz-Signature") === querySignature;
    }
    const authorization = request.headers.get("Authorization");
    const amzDate = request.headers.get("X-Amz-Date");
    if (authorization === null || amzDate === null) return false;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!["authorization", "x-amz-date", "x-amz-content-sha256"].includes(name)) headers[name] = value;
    });
    const again = await client.sign(request.url, { method: request.method, headers, body: body.byteLength ? (body as BodyInit) : undefined, aws: { datetime: amzDate } });
    return again.headers.get("Authorization") === authorization;
  }

  async function handle(request: Request): Promise<Response> {
    if (failures.times > 0) {
      failures.times -= 1;
      return new Response("fake S3 was told to fail", { status: failures.status });
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (!(await signedRightly(request, body))) return new Response("SignatureDoesNotMatch", { status: 403 });
    const path = decodeURIComponent(new URL(request.url).pathname);
    const prefix = `/${access.bucket}/`;
    if (!path.startsWith(prefix)) return new Response("NoSuchBucket", { status: 404 });
    const key = path.slice(prefix.length);
    const object = objects.get(key);
    switch (request.method) {
      case "PUT":
        objects.set(key, { body, contentType: request.headers.get("Content-Type") ?? "application/octet-stream" });
        return new Response(null, { status: 200 });
      case "GET": {
        if (!object) return new Response("NoSuchKey", { status: 404 });
        const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get("Range") ?? "");
        if (!range) return new Response(object.body as BodyInit, { status: 200, headers: { "Content-Type": object.contentType } });
        const part = object.body.subarray(Number(range[1]), Number(range[2]) + 1);
        return new Response(part as BodyInit, {
          status: 206,
          headers: { "Content-Type": object.contentType, "Content-Range": `bytes ${range[1]}-${Number(range[1]) + part.byteLength - 1}/${object.body.byteLength}` },
        });
      }
      case "DELETE":
        objects.delete(key);
        return new Response(null, { status: 204 });
      default:
        return new Response("MethodNotAllowed", { status: 405 });
    }
  }

  return {
    fetch: handle,
    endpoint,
    objects,
    failNext(times, status) {
      failures = { times, status };
    },
    advance(ms) {
      skew += ms;
    },
  };
}
