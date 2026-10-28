/** A browser following a host's ticket, as the dashboard's uploader does. */
import type { HostTicket, MediaHost } from "../host";

export async function followTicket(
  ticket: HostTicket,
  file: { key: string; body: Uint8Array; contentType: string },
  send: (request: Request) => Promise<Response>,
  relay: MediaHost,
): Promise<{ ok: boolean; hostRef: string | null }> {
  if (ticket.kind === "relay") {
    await relay.put({ key: file.key, contentType: file.contentType as "image/png", body: file.body });
    return { ok: true, hostRef: null };
  }
  if (ticket.kind === "put") {
    const response = await send(new Request(ticket.url, { method: "PUT", headers: ticket.headers, body: file.body as BodyInit }));
    return { ok: response.ok, hostRef: null };
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.set(name, value);
  form.set(ticket.fileField, new Blob([file.body], { type: file.contentType }), ticket.fields.fileName ?? "file");
  const response = await send(new Request(ticket.url, { method: "POST", body: form }));
  return { ok: response.ok, hostRef: response.ok ? ((await response.json()) as { fileId: string }).fileId : null };
}
