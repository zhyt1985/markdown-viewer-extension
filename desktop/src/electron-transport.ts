import type { MessageTransport, Unsubscribe } from '../../src/messaging/transports/transport';

export class ElectronTransport implements MessageTransport {
  private unsubscribe: Unsubscribe | undefined;
  private listeners = new Set<(message: unknown) => void>();
  constructor(private bridge: {
    service(envelope: unknown): Promise<unknown>;
    onService(handler: (message: unknown) => void): Unsubscribe;
  }) {
    this.unsubscribe = bridge.onService(message => { for (const listener of this.listeners) listener(message); });
  }
  // Convert rejected native IPC calls to the existing channel's error envelope,
  // including for fire-and-forget post() calls, rather than leaking rejections.
  async send(message: unknown) {
    try { return await this.bridge.service(message); }
    catch (error) { return { type: 'RESPONSE', requestId: (message as { id?: string })?.id,
      ok: false, error: { message: error instanceof Error ? error.message : String(error) } }; }
  }
  onMessage(handler: (message: unknown) => void): Unsubscribe {
    this.listeners.add(handler); return () => { this.listeners.delete(handler); };
  }
  close() { this.unsubscribe?.(); this.listeners.clear(); }
}
