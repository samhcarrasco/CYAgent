import { join } from 'node:path';

export function ticketMarkdownPath(ticketsDir: string, ticket: string): string {
  return join(ticketsDir, `${encodeURIComponent(ticket)}.md`);
}
